// Region-level IP geolocation for the home feed ("near me first", nearHome.js).
//
// Data: src/data/geoip-regions.bin.gz, a compact distillation of DB-IP "IP to City Lite"
// (CC BY 4.0, https://db-ip.com) built by scripts/build-geoip.js. Only US and CA (with state/province)
// survive, every other country is 'XX'; sorted range starts + one value per range, so a lookup is a
// binary search over typed arrays. IPv6 is keyed by the upper 64 bits (the routing prefix).
//
// Privacy: an address is parsed and looked up in memory and never stored, cached or logged here.
// Failure: if the file is missing or corrupt, lookupIp() returns null and one warning is logged
// (nearHome.js then falls through to the time-zone hint).
import fs from 'node:fs';
import net from 'node:net';
import zlib from 'node:zlib';
import defaultLogger from '../utils/logger.js';

export const GEOIP_FILE = new URL('../data/geoip-regions.bin.gz', import.meta.url);
export const GEOIP_ATTRIBUTION = 'IP Geolocation by DB-IP';
export const GEOIP_ATTRIBUTION_URL = 'https://db-ip.com';
const MAGIC = 'GIP1';

// Private, loopback, link-local, CGNAT, documentation and multicast ranges never hold a client we can place.
function isPrivateV4(n) {
  const a = n >>> 24, b = (n >>> 16) & 255;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

// Text -> { v: 4, n } | { v: 6, hi: BigInt } | null. IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as IPv4.
export function parseIp(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  const kind = net.isIP(s);
  if (kind === 4) {
    const p = s.split('.').map(Number);
    return { v: 4, n: ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 };
  }
  if (kind !== 6) return null;
  let head = s, tail4 = null;
  const dot = s.lastIndexOf('.');
  if (dot >= 0) {                                   // embedded dotted quad -> two hextets
    const c = s.lastIndexOf(':');
    const q = s.slice(c + 1).split('.').map(Number);
    tail4 = [((q[0] << 8) | q[1]), ((q[2] << 8) | q[3])];
    head = s.slice(0, c + 1) + '0:0';
  }
  const [l, r = null] = head.split('::');
  const left = l ? l.split(':') : [];
  const right = r === null ? [] : (r ? r.split(':') : []);
  const fill = r === null ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right].map(h => parseInt(h, 16));
  if (groups.length !== 8 || groups.some(g => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  if (tail4) { groups[6] = tail4[0]; groups[7] = tail4[1]; }
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {   // ::ffff:a.b.c.d
    return { v: 4, n: ((groups[6] << 16) | groups[7]) >>> 0 };
  }
  const hi = (BigInt(groups[0]) << 48n) | (BigInt(groups[1]) << 32n) | (BigInt(groups[2]) << 16n) | BigInt(groups[3]);
  return { v: 6, hi };
}

// True for an address we should not geolocate (private/reserved IPv4, loopback/ULA/link-local IPv6).
export function isNonPublic(ip) {
  if (ip.v === 4) return isPrivateV4(ip.n);
  const top = Number(ip.hi >> 48n);
  return ip.hi === 0n || (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 || (top & 0xff00) === 0xff00
    || (top === 0x2001 && ((ip.hi >> 32n) & 0xffffn) === 0xdb8n);
}

// ---- file format (before gzip) ------------------------------------------------------------------
// "GIP1" | u32 headerLen | header JSON (utf8) padded to 8 | starts4 u32[n4] | vals4 u16[n4] (padded to 8)
// | starts6 u64[n6] | vals6 u16[n6]. header = { source, date, values: ['CC'|'CC-RR', ...], n4, n6 }.
// values[0] is '' = "no data". Every range runs until the next start, so there are no end columns.
export function encodeGeoDb({ meta, values, starts4, vals4, starts6, vals6 }) {
  const header = Buffer.from(JSON.stringify({ ...meta, values, n4: starts4.length, n6: starts6.length }), 'utf8');
  const pad = (n) => (8 - (n % 8)) % 8;
  const parts = [Buffer.from(MAGIC), Buffer.alloc(4)];
  parts[1].writeUInt32LE(header.length);
  parts.push(header, Buffer.alloc(pad(8 + header.length)));
  const raw = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
  parts.push(raw(Uint32Array.from(starts4)), raw(Uint16Array.from(vals4)), Buffer.alloc(pad(starts4.length * 6)));
  parts.push(raw(BigUint64Array.from(starts6)), raw(Uint16Array.from(vals6)));
  return Buffer.concat(parts);
}

export function decodeGeoDb(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== MAGIC) throw new Error('bad geoip file');
  const hl = buf.readUInt32LE(4);
  if (8 + hl > buf.length) throw new Error('truncated geoip file');
  const meta = JSON.parse(buf.toString('utf8', 8, 8 + hl));
  let off = 8 + hl; off += (8 - (off % 8)) % 8;
  const take = (Type, n) => {                     // zero-copy view when aligned (the format pads to 8), else a copy
    const bytes = n * Type.BYTES_PER_ELEMENT;
    if (off + bytes > buf.length) throw new Error('truncated geoip file');
    const at = buf.byteOffset + off;
    const out = at % Type.BYTES_PER_ELEMENT === 0
      ? new Type(buf.buffer, at, n)
      : new Type(buf.buffer.slice(at, at + bytes));
    off += bytes;
    return out;
  };
  const starts4 = take(Uint32Array, meta.n4), vals4 = take(Uint16Array, meta.n4);
  off += (8 - (off % 8)) % 8;
  const starts6 = take(BigUint64Array, meta.n6), vals6 = take(Uint16Array, meta.n6);
  return { meta, values: meta.values, starts4, vals4, starts6, vals6 };
}

// Largest i with starts[i] <= key, or -1.
function floorIndex(starts, key) {
  let lo = 0, hi = starts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= key) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function createGeoIp({ file = GEOIP_FILE, logger = { warn() {} }, readFile = fs.readFileSync } = {}) {
  let db; // undefined = not loaded yet, null = unavailable
  function load() {
    if (db !== undefined) return db;
    try { db = decodeGeoDb(zlib.gunzipSync(readFile(file))); }
    catch (e) { db = null; logger.warn({ error: e.message }, 'geoip data unavailable; the home feed falls back to the time-zone hint'); }
    return db;
  }
  // text -> { country: 'US', region: 'CA' | '' } | null (private/invalid address, no data, or data file missing)
  function lookup(text) {
    const ip = parseIp(text);
    if (!ip || isNonPublic(ip)) return null;
    const d = load();
    if (!d) return null;
    const i = ip.v === 4 ? floorIndex(d.starts4, ip.n) : floorIndex(d.starts6, ip.hi);
    if (i < 0) return null;
    const v = d.values[(ip.v === 4 ? d.vals4 : d.vals6)[i]];
    if (!v) return null;
    const [country, region = ''] = v.split('-');
    return { country, region };
  }
  return { lookup, load, info: () => (load() ? { ...load().meta, values: undefined } : null) };
}

export const geoip = createGeoIp({ logger: defaultLogger });
