import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearEnabled, nearApplicable, tzHome, profileHome, clientIp, ipHome, resolveHome, homeSig, nearPayload, TZ_ZONES } from './nearHome.js';
import { US_STATES, CA_PROVINCES } from './places.js';

// A geoip stand-in: address -> { country, region } | null
const geo = (table) => ({ lookup: (ip) => table[ip] ?? null });
const G = geo({
  '1.1.1.1': { country: 'US', region: 'TX' },
  '2.2.2.2': { country: 'US', region: '' },          // US but no state
  '3.3.3.3': { country: 'XX', region: '' },          // some other country
  '4.4.4.4': { country: 'CA', region: 'ON' },
});

test('nearEnabled: default off, needs FEED_NEAR=on AND FEED_ORDER=feed_at', () => {
  assert.equal(nearEnabled({}), false);
  assert.equal(nearEnabled({ FEED_NEAR: 'on' }), false);                          // sort_at order: no supporting index
  assert.equal(nearEnabled({ FEED_ORDER: 'feed_at' }), false);
  assert.equal(nearEnabled({ FEED_NEAR: 'off', FEED_ORDER: 'feed_at' }), false);
  assert.equal(nearEnabled({ FEED_NEAR: 'true', FEED_ORDER: 'feed_at' }), false); // exactly 'on'
  assert.equal(nearEnabled({ FEED_NEAR: 'on', FEED_ORDER: 'feed_at' }), true);
});

test('nearApplicable: country-level lists only', () => {
  assert.equal(nearApplicable({ country: 'US' }), true);
  assert.equal(nearApplicable({ country: 'CA' }), true);
  assert.equal(nearApplicable({ country: 'US', role: 'engineering', type: 'full_time', days: 7 }), true);
  assert.equal(nearApplicable({ country: '' }), false);                 // worldwide
  assert.equal(nearApplicable({ country: 'US', region: 'TX' }), false); // state
  assert.equal(nearApplicable({ country: 'US', city: 'austin' }), false);
  assert.equal(nearApplicable({ country: 'US', region: 'TX', city: 'austin' }), false);
  assert.equal(nearApplicable({ country: 'US', remote: true }), false); // already only remote
  assert.equal(nearApplicable({ country: 'US', q: 'nurse' }), false);   // keyword search
  assert.equal(nearApplicable({ country: 'GB' }), false);               // no region codes there
});

test('tz table: every region is a real code of its country; no zone is empty', () => {
  assert.ok(Object.keys(TZ_ZONES).length > 40);
  for (const [name, z] of Object.entries(TZ_ZONES)) {
    const known = z.country === 'US' ? US_STATES : CA_PROVINCES;
    assert.ok(z.regions.length && z.label, name);
    for (const r of z.regions) assert.ok(known[r], `${name}: ${r}`);
    assert.equal(new Set(z.regions).size, z.regions.length, `${name} has duplicates`);
  }
});

test('tzHome: documented sets', () => {
  assert.deepEqual(tzHome('America/Los_Angeles', 'US').regions.sort(), ['CA', 'NV', 'OR', 'WA']);
  assert.equal(tzHome('America/Los_Angeles', 'US').label, 'Pacific time zone states');
  assert.deepEqual(tzHome('America/Denver', 'US').regions.sort(), ['AZ', 'CO', 'ID', 'MT', 'NM', 'UT', 'WY']);
  assert.ok(tzHome('America/Chicago', 'US').regions.includes('TX'));
  assert.ok(tzHome('America/New_York', 'US').regions.includes('NY'));
  assert.deepEqual(tzHome('America/Phoenix', 'US'), { regions: ['AZ'], label: 'Arizona' });
  assert.deepEqual(tzHome('America/Anchorage', 'US').regions, ['AK']);
  assert.deepEqual(tzHome('Pacific/Honolulu', 'US').regions, ['HI']);
  assert.deepEqual(tzHome('America/Toronto', 'CA').regions, ['ON', 'QC']);
  assert.deepEqual(tzHome('America/Vancouver', 'CA').regions, ['BC']);
  // the regions of the four big zones do not overlap (a state is in at most one of them)
  const seen = new Map();
  for (const z of ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York']) {
    for (const r of tzHome(z, 'US').regions) { assert.equal(seen.has(r), false, `${r} in ${z} and ${seen.get(r)}`); seen.set(r, z); }
  }
});

test('tzHome: ignores malformed, unknown, oversized and wrong-country hints', () => {
  for (const bad of [undefined, null, '', 'UTC', 'Europe/Berlin', 'America/Nowhere', 'America/', '/America/Denver', 'America/Denver; DROP', '../etc/passwd', 'America/Los_Angeles\n', 'x'.repeat(200), 42, ['America/Denver'], 'constructor/prototype', '__proto__/x']) {
    assert.equal(tzHome(bad, 'US'), null, String(bad));
  }
  assert.equal(tzHome('America/Toronto', 'US'), null);   // Canadian zone, US list
  assert.equal(tzHome('America/Denver', 'CA'), null);
});

test('profileHome: only a region of the requested country counts', () => {
  assert.deepEqual(profileHome('San Francisco, CA', 'US'), { regions: ['CA'], label: 'California' });
  assert.deepEqual(profileHome('  Austin ,  TX ', 'US'), { regions: ['TX'], label: 'Texas' });
  assert.deepEqual(profileHome('Texas', 'US'), { regions: ['TX'], label: 'Texas' });
  assert.deepEqual(profileHome('Toronto, ON', 'CA'), { regions: ['ON'], label: 'Ontario' });
  assert.equal(profileHome('Toronto, ON', 'US'), null);      // resolves, but to another country
  assert.equal(profileHome('Austin, TX', 'CA'), null);
  for (const t of ['USA', 'United States', 'Germany', 'Berlin, Germany', 'Remote', '', '   ', null, undefined, 7]) assert.equal(profileHome(t, 'US'), null, String(t));
  assert.equal(profileHome('x'.repeat(5000), 'US'), null);
});

test('clientIp: first fly-client-ip value, else req.ip, never x-forwarded-for', () => {
  assert.equal(clientIp({ headers: { 'fly-client-ip': '203.0.113.9' }, ip: '172.16.0.2' }), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'fly-client-ip': ' 198.51.100.7 , 10.0.0.1' }, ip: '172.16.0.2' }), '198.51.100.7');
  assert.equal(clientIp({ headers: {}, ip: '8.8.8.8' }), '8.8.8.8');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9' } }), '');
  assert.equal(clientIp({}), '');
  assert.equal(clientIp(undefined), '');
});

test('ipHome: region in the requested country; foreign country is flagged; no data is neutral', () => {
  assert.deepEqual(ipHome('1.1.1.1', 'US', G), { home: { regions: ['TX'], label: 'Texas' }, foreign: false });
  assert.deepEqual(ipHome('2.2.2.2', 'US', G), { home: null, foreign: false });
  assert.deepEqual(ipHome('3.3.3.3', 'US', G), { home: null, foreign: true });
  assert.deepEqual(ipHome('4.4.4.4', 'US', G), { home: null, foreign: true });
  assert.deepEqual(ipHome('4.4.4.4', 'CA', G), { home: { regions: ['ON'], label: 'Ontario' }, foreign: false });
  assert.deepEqual(ipHome('9.9.9.9', 'US', G), { home: null, foreign: false });
  assert.deepEqual(ipHome('', 'US', G), { home: null, foreign: false });
});

test('homeSig: sorted, order independent', () => {
  assert.equal(homeSig(['WA', 'CA', 'OR']), 'CA,OR,WA');
  assert.equal(homeSig(['CA']), 'CA');
});

test('ladder: profile > ip > tz > none', () => {
  const base = { country: 'US', geo: G };
  // all three present: the saved location wins
  let h = resolveHome({ ...base, profileLocation: 'Boston, MA', ip: '1.1.1.1', tz: 'America/Los_Angeles' });
  assert.deepEqual([h.source, h.regions, h.label], ['profile', ['MA'], 'Massachusetts']);
  // profile does not resolve to a region of the country: the IP is next
  h = resolveHome({ ...base, profileLocation: 'Germany', ip: '1.1.1.1', tz: 'America/Los_Angeles' });
  assert.deepEqual([h.source, h.regions], ['ip', ['TX']]);
  h = resolveHome({ ...base, profileLocation: 'Toronto, ON', ip: '1.1.1.1' });
  assert.equal(h.source, 'ip');
  // no profile: IP
  h = resolveHome({ ...base, ip: '1.1.1.1', tz: 'America/Los_Angeles' });
  assert.deepEqual([h.source, h.regions, h.label], ['ip', ['TX'], 'Texas']);
  // IP without a state (or unknown / private / missing): the time zone
  for (const ip of ['2.2.2.2', '9.9.9.9', '10.0.0.1', '']) {
    h = resolveHome({ ...base, ip, tz: 'America/Los_Angeles' });
    assert.deepEqual([h.source, h.regions, h.label], ['tz', ['CA', 'NV', 'OR', 'WA'], 'Pacific time zone states'], ip);
  }
  // nothing usable: none
  assert.equal(resolveHome({ ...base, ip: '2.2.2.2', tz: 'Europe/Berlin' }), null);
  assert.equal(resolveHome({ ...base, ip: '', tz: '' }), null);
  assert.equal(resolveHome({ ...base }), null);
  // a tz of another country does not apply
  assert.equal(resolveHome({ ...base, tz: 'America/Toronto' }), null);
  assert.equal(resolveHome({ country: 'CA', geo: G, tz: 'America/Toronto' }).source, 'tz');
});

test('ladder: an IP in another country ends the ladder (no tz rescue), a saved location still wins', () => {
  assert.equal(resolveHome({ country: 'US', geo: G, ip: '3.3.3.3', tz: 'America/New_York' }), null);
  assert.equal(resolveHome({ country: 'US', geo: G, ip: '4.4.4.4', tz: 'America/New_York' }), null);
  assert.equal(resolveHome({ country: 'US', geo: G, ip: '3.3.3.3', tz: 'America/New_York', profileLocation: 'Austin, TX' }).source, 'profile');
});

test('ladder: result regions are sorted and the payload is just source/regions/label', () => {
  const h = resolveHome({ country: 'US', geo: G, tz: 'America/New_York' });
  assert.deepEqual(h.regions, [...h.regions].sort());
  assert.equal(h.sig, h.regions.join(','));
  assert.deepEqual(Object.keys(nearPayload(h)), ['source', 'regions', 'label']);
});
