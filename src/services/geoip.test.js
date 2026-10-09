import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseIp, isNonPublic, encodeGeoDb, decodeGeoDb, createGeoIp, GEOIP_FILE } from './geoip.js';

test('parseIp: IPv4, IPv6, mapped, bracketed, zone ids, garbage', () => {
  assert.deepEqual(parseIp('8.8.8.8'), { v: 4, n: 0x08080808 });
  assert.deepEqual(parseIp('255.255.255.255'), { v: 4, n: 0xffffffff });
  assert.deepEqual(parseIp('2001:4860:4860::8888'), { v: 6, hi: 0x2001486048600000n });
  assert.deepEqual(parseIp('2607:f8b0:4005:80a:0:0:0:200e'), { v: 6, hi: 0x2607f8b04005080an });
  assert.deepEqual(parseIp('::ffff:8.8.8.8'), { v: 4, n: 0x08080808 });
  assert.deepEqual(parseIp('[2001:4860:4860::8888]'), parseIp('2001:4860:4860::8888'));
  assert.deepEqual(parseIp('fe80::1%en0'), parseIp('fe80::1'));
  for (const bad of ['', 'nope', '1.2.3', '1.2.3.256', '12345::', null, undefined, 42]) assert.equal(parseIp(bad), null, String(bad));
});

test('isNonPublic: private, loopback, CGNAT, link-local, ULA, documentation', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', '100.64.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isNonPublic(parseIp(ip)), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2607:f8b0:4005:80a::200e']) assert.equal(isNonPublic(parseIp(ip)), false, ip);
});

// A tiny table: 1.0.0.0/8 = US-CA, 2.0.0.0/8 = US-NY, 3.0.0.0/8 = XX, 4.0.0.0/8 = US (no region); everything else no data.
const FIXTURE = () => encodeGeoDb({
  meta: { source: 'fixture' }, values: ['', 'US-CA', 'US-NY', 'XX', 'US'],
  starts4: [0x01000000, 0x02000000, 0x03000000, 0x04000000, 0x05000000], vals4: [1, 2, 3, 4, 0],
  starts6: [0x2607f8b000000000n, 0x2a00000000000000n], vals6: [1, 3],
});

test('encode/decode round-trips and rejects bad files', () => {
  const d = decodeGeoDb(FIXTURE());
  assert.deepEqual([...d.starts4], [0x01000000, 0x02000000, 0x03000000, 0x04000000, 0x05000000]);
  assert.deepEqual([...d.starts6], [0x2607f8b000000000n, 0x2a00000000000000n]);
  assert.deepEqual(d.values, ['', 'US-CA', 'US-NY', 'XX', 'US']);
  assert.throws(() => decodeGeoDb(Buffer.from('nonsense bytes here')), /bad geoip file/);
  assert.throws(() => decodeGeoDb(FIXTURE().subarray(0, 40)), /truncated|RangeError|Invalid/);
});

function withFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoip-'));
  const f = path.join(dir, 'g.bin.gz');
  fs.writeFileSync(f, zlib.gzipSync(FIXTURE()));
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('lookup: region, country-only, other country, no data, IPv6, mapped IPv4', () => withFile((file) => {
  const g = createGeoIp({ file });
  assert.deepEqual(g.lookup('1.2.3.4'), { country: 'US', region: 'CA' });
  assert.deepEqual(g.lookup('2.255.255.255'), { country: 'US', region: 'NY' });
  assert.deepEqual(g.lookup('3.0.0.1'), { country: 'XX', region: '' });
  assert.deepEqual(g.lookup('4.4.4.4'), { country: 'US', region: '' });
  assert.equal(g.lookup('5.5.5.5'), null);            // explicit "no data" run
  assert.equal(g.lookup('0.1.2.3'), null);            // before the first range
  assert.deepEqual(g.lookup('2607:f8b0:4005:80a::200e'), { country: 'US', region: 'CA' });
  assert.deepEqual(g.lookup('2a00:1450::1'), { country: 'XX', region: '' });
  assert.equal(g.lookup('2001:db8::1'), null);
  assert.deepEqual(g.lookup('::ffff:1.2.3.4'), { country: 'US', region: 'CA' });
  assert.equal(g.lookup('10.0.0.1'), null);           // private: never looked up
  assert.equal(g.lookup('not an ip'), null);
}));

test('missing or corrupt data: lookups return null and the warning is logged once', () => {
  for (const file of [new URL('file:///nonexistent/geoip.bin.gz'), (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'geoip-')); const f = path.join(d, 'x.gz'); fs.writeFileSync(f, 'garbage'); return f; })()]) {
    const warns = [];
    const g = createGeoIp({ file, logger: { warn: (o, m) => warns.push(m) } });
    assert.equal(g.lookup('8.8.8.8'), null);
    assert.equal(g.lookup('1.1.1.1'), null);
    assert.equal(g.lookup('2607:f8b0::1'), null);
    assert.equal(warns.length, 1);
  }
});

test('the committed data file loads and places well-known addresses', () => {
  const g = createGeoIp({ file: GEOIP_FILE });
  const d = g.load();
  assert.ok(d, 'src/data/geoip-regions.bin.gz must load');
  assert.ok(d.starts4.length > 100_000 && d.starts6.length > 50_000);
  assert.equal(g.lookup('8.8.8.8').country, 'US');
  assert.equal(g.lookup('1.1.1.1').country, 'XX');
  assert.equal(g.lookup('192.168.0.1'), null);
  // universities: stable enough across monthly refreshes to pin the state
  assert.deepEqual(g.lookup('128.32.0.1'), { country: 'US', region: 'CA' });   // UC Berkeley
  assert.deepEqual(g.lookup('18.9.22.69'), { country: 'US', region: 'MA' });   // MIT
  assert.deepEqual(g.lookup('128.83.1.1'), { country: 'US', region: 'TX' });   // UT Austin
});
