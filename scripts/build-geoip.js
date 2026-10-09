// Distils DB-IP "IP to City Lite" (CSV) into src/data/geoip-regions.bin.gz, the region-level table
// src/services/geoip.js looks addresses up in. Offline tool: run it by hand, commit the output.
//
//   node scripts/build-geoip.js 2026-10                  download dbip-city-lite-2026-10.csv.gz and build
//   node scripts/build-geoip.js ./dbip-city-lite.csv.gz  build from a local file (.csv or .csv.gz)
//   optional 2nd argument: output path (default src/data/geoip-regions.bin.gz)
//
// Source: https://db-ip.com/db/download/ip-to-city-lite, licence CC BY 4.0, attribution
// "IP Geolocation by DB-IP" with a link to https://db-ip.com (see docs/geoip.md).
// Kept: US and CA with their state/province (mapped to the codes job_feed uses); every other country is
// collapsed to 'XX' (job_feed has region codes for US and CA only). City, coordinates and all other detail
// are dropped; adjacent ranges with the same value are merged.
// Writes nothing and exits non-zero if the result looks wrong (sanity floor on ranges/known addresses).
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { US_STATES, CA_PROVINCES } from '../src/services/places.js';
import { parseIp, encodeGeoDb, decodeGeoDb, createGeoIp } from '../src/services/geoip.js';

const arg = process.argv[2];
const out = process.argv[3] || new URL('../src/data/geoip-regions.bin.gz', import.meta.url).pathname;
if (!arg) { console.error('usage: node scripts/build-geoip.js <YYYY-MM | file.csv[.gz]> [out]'); process.exit(2); }

const byName = (m) => Object.fromEntries(Object.entries(m).map(([c, n]) => [n.toLowerCase(), c]));
const REGION = { US: byName(US_STATES), CA: byName(CA_PROVINCES) };

function parseCsvLine(line) {
  const f = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { f.push(cur); cur = ''; } else cur += c;
  }
  f.push(cur);
  return f;
}

async function openInput() {
  let stream, label = arg, date = null;
  if (/^\d{4}-\d{2}$/.test(arg)) {
    date = arg;
    const url = `https://download.db-ip.com/free/dbip-city-lite-${arg}.csv.gz`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
    stream = Readable.fromWeb(res.body); label = url;
    return { stream: stream.pipe(zlib.createGunzip()), label, date };
  }
  date = (path.basename(arg).match(/(\d{4}-\d{2})/) || [])[1] || null;
  stream = fs.createReadStream(arg);
  return { stream: arg.endsWith('.gz') ? stream.pipe(zlib.createGunzip()) : stream, label: path.basename(arg), date };
}

const { stream, label, date } = await openInput();
const valueIndex = new Map([['', 0]]);
const values = [''];
const idOf = (v) => { let i = valueIndex.get(v); if (i === undefined) { i = values.length; values.push(v); valueIndex.set(v, i); } return i; };

// Runs per family: starts[] and vals[] with gap filling (value 0 = no data).
const fam = { 4: { starts: [], vals: [], next: 0 }, 6: { starts: [], vals: [], next: 0n } };
const unmapped = new Map();
let rows = 0, skipped = 0;
function push(f, start, endExclusive, v) {
  if (start < f.next) { skipped++; return; }                        // overlapping or unsorted row: keep the first
  if (start > f.next) pushRun(f, f.next, 0);                         // gap -> no data
  pushRun(f, start, v);
  f.next = endExclusive;
}
function pushRun(f, start, v) {
  const n = f.vals.length;
  if (n && f.vals[n - 1] === v) return;                              // merge adjacent identical runs
  f.starts.push(start); f.vals.push(v);
}

for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
  if (!line) continue;
  const c = parseCsvLine(line);
  if (c.length < 5) { skipped++; continue; }
  const a = parseIp(c[0]), b = parseIp(c[1]);
  if (!a || !b || a.v !== b.v) { skipped++; continue; }
  rows++;
  const cc = c[3].toUpperCase();
  let v = '';
  if (/^[A-Z]{2}$/.test(cc) && cc !== 'ZZ') {
    v = 'XX';   // any other country: only "not US/CA" matters (job_feed has region codes for US and CA only); merging these shrinks the table ~4x
    if (REGION[cc]) {
      v = cc;
      const code = REGION[cc][c[4].toLowerCase()];
      if (code) v = `${cc}-${code}`;
      else if (c[4]) unmapped.set(`${cc}|${c[4]}`, (unmapped.get(`${cc}|${c[4]}`) || 0) + 1);
    }
  }
  if (a.v === 4) push(fam[4], a.n, b.n + 1, idOf(v));
  else push(fam[6], a.hi, b.hi + 1n, idOf(v));
}
// A trailing gap to the end of the space needs no run: the last run extends to the top by construction.

console.log(`rows ${rows} (skipped ${skipped}); ranges v4 ${fam[4].starts.length}, v6 ${fam[6].starts.length}; values ${values.length}`);
if (unmapped.size) console.log('US/CA names not mapped to a region code (kept as country only):', [...unmapped]);

const buf = encodeGeoDb({
  meta: { source: 'DB-IP IP to City Lite', license: 'CC BY 4.0', attribution: 'IP Geolocation by DB-IP (https://db-ip.com)', date, input: label },
  values, starts4: fam[4].starts, vals4: fam[4].vals, starts6: fam[6].starts, vals6: fam[6].vals,
});
const gz = zlib.gzipSync(buf, { level: 9 });
const tmp = out + '.tmp';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(tmp, gz);

// Sanity gate before replacing the committed file.
const probe = createGeoIp({ file: tmp });
const d = probe.load();
const checks = [['8.8.8.8', 'US'], ['1.1.1.1', 'XX'], ['2001:4860:4860::8888', null]];   // null: any answer
const bad = !d || d.starts4.length < 100_000 || d.starts6.length < 50_000
  || checks.some(([ip, cc]) => (cc ? probe.lookup(ip)?.country !== cc : !probe.lookup(ip)));
if (bad) { console.error('ranges', d?.starts4.length, d?.starts6.length, checks.map(([ip]) => `${ip} ${JSON.stringify(probe.lookup(ip))}`)); fs.unlinkSync(tmp); console.error('sanity check failed; output not written'); process.exit(1); }
fs.renameSync(tmp, out);
console.log(`wrote ${out}: ${gz.length} bytes gzip, ${buf.length} raw`);
