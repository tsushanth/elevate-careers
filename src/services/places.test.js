// src/services/places.test.js
// Fixtures are real raw job_location values from production (2026-10-07):
// "City, ST" was stored with country repeating the state code, "London, UK"
// with country "UK", and so on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocationRow as n, normalizeJobLocations } from './places.js';

const loc = (r) => ({ country_code: r.country_code, region_code: r.region_code, city: r.city });

test('US state codes stored in the country column resolve to the US', () => {
  assert.deepEqual(loc(n({ city: 'San Francisco', region: 'CA', country: 'CA' })),
    { country_code: 'US', region_code: 'CA', city: 'San Francisco' });
  assert.deepEqual(loc(n({ city: 'Austin', region: 'TX', country: 'TX' })),
    { country_code: 'US', region_code: 'TX', city: 'Austin' });
});

test('Georgia the US state is not the country', () => {
  assert.deepEqual(loc(n({ city: 'Atlanta', region: 'Georgia', country: 'Georgia' })),
    { country_code: 'US', region_code: 'GA', city: 'Atlanta' });
});

test('Canadian province with country CA is Canada, not California', () => {
  assert.deepEqual(loc(n({ city: 'Toronto', region: 'ON', country: 'CA' })),
    { country_code: 'CA', region_code: 'ON', city: 'Toronto' });
  assert.deepEqual(loc(n({ city: 'Vancouver', region: 'BC', country: null })),
    { country_code: 'CA', region_code: 'BC', city: 'Vancouver' });
});

test('two-letter token that is also a US state code defers to a known foreign city', () => {
  assert.equal(n({ city: 'Pune', region: null, country: 'IN' }).country_code, 'IN');
  assert.equal(n({ city: 'Berlin', region: null, country: 'DE' }).country_code, 'DE');
  // Indianapolis is not in the foreign city dictionary, so IN is Indiana.
  assert.deepEqual(loc(n({ city: 'Indianapolis', region: 'IN', country: 'IN' })),
    { country_code: 'US', region_code: 'IN', city: 'Indianapolis' });
});

test('spelled-out and synonym countries', () => {
  assert.equal(n({ city: 'London', region: null, country: 'UK' }).country_code, 'GB');
  assert.equal(n({ city: 'London', region: 'UK', country: 'UK' }).country_code, 'GB');
  assert.equal(n({ city: 'Paris', region: null, country: 'France' }).country_code, 'FR');
  assert.deepEqual(loc(n({ city: 'San Francisco', region: 'California', country: 'United States' })),
    { country_code: 'US', region_code: 'CA', city: 'San Francisco' });
});

test('"Remote" and similar are not cities', () => {
  assert.deepEqual(loc(n({ city: 'Remote', region: null, country: 'United States' })),
    { country_code: 'US', region_code: null, city: null });
});

test('a city that is only in the dictionary resolves through it', () => {
  assert.equal(n({ city: 'Manchester', region: null, country: null }).country_code, 'GB');
});

test('unresolvable input is ZZ, never a guess', () => {
  assert.equal(n({ city: null, region: null, country: null }).country_code, 'ZZ');
  assert.equal(n({ city: 'Anywhere', region: null, country: null }).country_code, 'ZZ');
  assert.equal(n({ city: null, region: null, country: 'Full-time' }).country_code, 'ZZ');
  // A bare "CA" with no city or region could be California or Canada.
  assert.equal(n({ city: null, region: null, country: 'CA' }).country_code, 'ZZ');
  assert.equal(n({ city: null, region: 'CA', country: 'CA' }).country_code, 'ZZ');
  assert.equal(n({ city: 'Remote', region: 'CA', country: 'CA' }).country_code, 'ZZ');
});

test('city_key is the lower-cased city, empty when there is none', () => {
  assert.equal(n({ city: 'San Francisco', region: 'CA', country: 'CA' }).city_key, 'san francisco');
  assert.equal(n({ city: null, region: null, country: 'United States' }).city_key, '');
});

test('normalizeJobLocations dedupes, drops ZZ when something resolves, never returns empty', () => {
  const rows = [
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Remote', region: null, country: null },
  ];
  const out = normalizeJobLocations(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].country_code, 'US');
  assert.deepEqual(normalizeJobLocations([]).map(r => r.country_code), ['ZZ']);
  assert.deepEqual(normalizeJobLocations([{ city: 'Anywhere' }]).map(r => r.country_code), ['ZZ']);
});
