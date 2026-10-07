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

// ---------------------------------------------------------------------------
// Coverage rules R1-R7. Fixtures are real raw rows from the 2026-10-07 labelled
// production sample unless noted ("unit" = a targeted synthetic case).
// ---------------------------------------------------------------------------
const row = (city, region, country) => ({ city: city ?? null, region: region ?? null, country: country ?? null });
const out = (r) => `${r.country_code}/${r.region_code || ''}`;
const check = (label, r, expected) => assert.equal(out(n(r)), expected, `${label}: ${JSON.stringify(r)}`);

test('R1 native-language country names', () => {
  check('nl', row('Veenendaal', 'Utrecht', 'Nederland'), 'NL/');
  check('nl', row('Den Haag', 'Zuid-Holland', 'Nederland'), 'NL/');
  check('be', row('Antwerpen', 'Antwerpen', 'België'), 'BE/');
  check('be', row('Waterloo', 'Waals-Brabant', 'België'), 'BE/');
  // unit: accent-tolerant and case-insensitive, whole token only
  check('be-ascii', row('Gent', null, 'BELGIE'), 'BE/');
  check('de', row('Köln', null, 'Deutschland'), 'DE/');
  check('at', row('Wien', null, 'Österreich'), 'AT/');
  check('ch', row('Bern', null, 'Schweiz'), 'CH/');
  check('ch', row('Lausanne', null, 'Suisse'), 'CH/');
  check('ch', row('Lugano', null, 'Svizzera'), 'CH/');
  check('es', row('Sevilla', null, 'España'), 'ES/');
  check('it', row('Torino', null, 'Italia'), 'IT/');
  check('mx', row('Puebla', null, 'México'), 'MX/');
  check('pl', row('Gdansk', null, 'Polska'), 'PL/');
  check('se', row('Malmo', null, 'Sverige'), 'SE/');
  check('no', row('Bergen', null, 'Norge'), 'NO/');
  check('dk', row('Odense', null, 'Danmark'), 'DK/');
  check('fi', row('Tampere', null, 'Suomi'), 'FI/');
  check('tr', row('Izmir', null, 'Türkiye'), 'TR/');
  check('tr', row('Izmir', null, 'Turkiye'), 'TR/');
  check('ie', row('Galway', null, 'Éire'), 'IE/');
  check('nl', row('Delft', null, 'The Netherlands'), 'NL/');
  check('gb', row('Cardiff', null, 'Wales'), 'GB/');
  check('gb', row('Aberdeen', null, 'Scotland'), 'GB/');
  check('gb', row('Derry', null, 'Northern Ireland'), 'GB/');
  // a longer string that merely contains the word is not a match
  check('whole-token', row(null, null, 'Nederlandse Antillen'), 'ZZ/');
});

test('R2 subnational names identify the country, region stays null', () => {
  check('bihar', row('Aurangabad', 'Bihar', 'Bihar'), 'IN/');
  check('leinster', row('Sandyford', 'Leinster', 'Leinster'), 'IE/');
  check('unit', row('Nashik', 'Maharashtra', null), 'IN/');
  check('unit', row('Kochi', 'Kerala', 'Kerala'), 'IN/');
  check('unit', row('Cork City', 'Munster', null), 'IE/');
  check('unit', row('Galway', 'Connacht', null), 'IE/');
  // ambiguous names are NOT in the list
  check('punjab', row('Amritsar', 'Punjab', 'Punjab'), 'ZZ/');
  check('victoria', row(null, 'Victoria', null), 'ZZ/');
  check('mizoram', row(null, 'Mizoram', null), 'ZZ/');
});

test('R3 pieces of a field are candidates; a spelled country in any of them wins', () => {
  check('co-us', row('Brighton', 'CO - US', 'CO - US'), 'US/CO');
  check('unit-split', row('Springfield', 'Remote - Canada', null), 'CA/');
  check('unit-slash', row(null, 'Germany/Austria', null), 'DE/');
  check('unit-city-piece', row('Remote - Poland', null, null), 'PL/');
  // existing state precedence stays: Wales WI is a Wisconsin town
  check('state-precedence', row('Wales', 'WI', 'WI'), 'US/WI');
});

test('R4 embedded US state code', () => {
  check('last-word', row('Bala Cynwyd PA'), 'US/PA');
  check('last-word', row('Colorado Springs CO'), 'US/CO');
  check('paren', row('Philadelphia PA (Center City HQ)'), 'US/PA');
  check('last-word', row('Joliet IL'), 'US/IL');
  check('last-word', row('Evanston IL'), 'US/IL');
  check('metro', row('Washington DC Metro Area'), 'US/DC');
  check('zip-first', row('Concord', 'NC 28025 | 35.384593939 | -80.561243123', 'NC 28025 | 35.384593939 | -80.561243123'), 'US/NC');
  check('zip-first', row('Bayonne', 'NJ 07002 | 40.666593804 | -74.118310442', 'NJ 07002 | 40.666593804 | -74.118310442'), 'US/NJ');
  check('colon', row('Mesa', 'AZ: Gilbert/McKellips', 'AZ: Gilbert/McKellips'), 'US/AZ');
  check('dash', row('Brighton', 'CO - US', 'CO - US'), 'US/CO');
  check('springfield', row('Springfield MO'), 'US/MO');
  // guards
  check('foreign-city-iso', row('Berlin DE'), 'DE/');
  check('foreign-city-iso', row('Pune IN'), 'IN/');
  check('spelled-foreign-wins', row('Mumbai', null, 'India'), 'IN/');
  check('spelled-foreign-wins', row('Evanston IL', null, 'India'), 'IN/');
  check('lowercase-word', row('Join us in'), 'ZZ/');
  check('noise-remainder', row('Remote OK'), 'ZZ/');
  check('canada-city', row('Toronto CA'), 'CA/');
  check('bare-ca-with-province', row('Toronto', 'ON', 'CA'), 'CA/ON');
  check('bare-ca-nothing', row(null, 'CA', 'CA'), 'ZZ/');
  check('ca-after-foreign-city', row('London CA'), 'ZZ/');
  check('plain-ca-city', row('Sunnyvale CA'), 'US/CA');
});

test('R5 trailing country word', () => {
  check('uk', row('Zilch UK'), 'GB/');
  check('uae', row('Dubai Internet City UAE'), 'AE/');
  check('usa', row('Austin TX USA'), 'US/TX');
  check('spelled', row('Munich Germany'), 'DE/');
  check('spelled', row('Belfast Northern Ireland'), 'GB/');
  check('multiword', row('Cambridge United Kingdom'), 'GB/');
  // US / us is never a trailing country word; New Mexico is a state
  check('join-us', row('Join us'), 'ZZ/');
  check('visit-us', row('Visit us'), 'ZZ/');
  check('lowercase-uk', row('Zilch uk'), 'ZZ/');
  check('part-of-word', row('Bukit'), 'ZZ/');
  check('new-mexico', row('Albuquerque New Mexico'), 'ZZ/'); // never Mexico; no rule names the state
});

test('R6 known cities among the tokens', () => {
  check('region-token', row('Kensington Office', 'London', 'London'), 'GB/');
  check('first-word', row('Seoul South'), 'KR/');
  check('two-words', row('Tel Aviv HQ'), 'IL/');
  // not when the rest of the piece names a state or province
  check('london-ontario', row('London Ontario'), 'ZZ/');
  check('london-on', row('London ON'), 'ZZ/');
  check('paris-texas', row('Paris Texas'), 'ZZ/'); // never France
  // conflicting cities do not guess
  check('conflict', row('Paris', 'London', null), 'ZZ/');
  // explicit state codes still beat the city dictionary
  check('paris-tx', row('Paris', 'TX', 'TX'), 'US/TX');
  check('dublin-oh', row('Dublin', 'OH', 'OH'), 'US/OH');
});

test('R7 US state names', () => {
  check('with-country', row('Florida', null, 'United States'), 'US/FL');
  check('dash', row('Minnesota - Minneapolis'), 'US/MN');
  check('bare', row('New York'), 'US/NY');
  check('bare', row('Florida'), 'US/FL');
  check('bare-washington', row('Washington'), 'ZZ/');
  check('bare-georgia', row('Georgia'), 'ZZ/');
  check('washington-with-country', row('Washington', null, 'United States'), 'US/');
  check('georgia-with-country', row('Georgia', null, 'United States'), 'US/GA');
  // New York as a city piece is the city, not a stated state, once the country is known
  check('ny-city-with-country', row('New York', null, 'United States'), 'US/');
  check('ny-state-region', row('Albany', 'New York', 'United States'), 'US/NY');
});

const MUST_STAY = [
  [row('Georgia'), 'ZZ/'], [row('Washington'), 'ZZ/'], [row('Remote'), 'ZZ/'],
  [row('Multiple Locations'), 'ZZ/'], [row('Lightning Labs'), 'ZZ/'], [row('Remote job'), 'ZZ/'],
  [row('APAC'), 'ZZ/'], [row('ASIA'), 'ZZ/'], [row(), 'ZZ/'], [row('Join us'), 'ZZ/'], [row('Visit us'), 'ZZ/'],
  [row('Pune', null, 'IN'), 'IN/'], [row('Indianapolis', 'IN', 'IN'), 'US/IN'], [row('Toronto', 'ON', 'CA'), 'CA/ON'],
  [row(null, null, 'CA'), 'ZZ/'], [row(null, 'CA', 'CA'), 'ZZ/'], [row('San Francisco', 'CA', 'CA'), 'US/CA'],
  [row('Atlanta', 'Georgia', 'Georgia'), 'US/GA'], [row('Paris', null, 'France'), 'FR/'], [row('Paris', 'TX', 'TX'), 'US/TX'],
  [row('Dublin', 'OH', 'OH'), 'US/OH'], [row('Dublin', null, 'Ireland'), 'IE/'], [row('Berlin DE'), 'DE/'],
  [row('Springfield MO'), 'US/MO'], [row('Mumbai', null, 'India'), 'IN/'],
];
test('behaviour that must not change', () => {
  for (const [r, exp] of MUST_STAY) check('stay', r, exp);
});

test('property: normalising twice is identical and normalizeJobLocations is never empty', () => {
  const existing = [
    row('San Francisco', 'CA', 'CA'), row('Austin', 'TX', 'TX'), row('Atlanta', 'Georgia', 'Georgia'),
    row('Toronto', 'ON', 'CA'), row('Vancouver', 'BC'), row('Pune', null, 'IN'), row('Berlin', null, 'DE'),
    row('Indianapolis', 'IN', 'IN'), row('London', null, 'UK'), row('London', 'UK', 'UK'), row('Paris', null, 'France'),
    row('San Francisco', 'California', 'United States'), row('Remote', null, 'United States'),
    row('Manchester'), row(), row('Anywhere'), row(null, null, 'Full-time'), row(null, null, 'CA'),
    row(null, 'CA', 'CA'), row('Remote', 'CA', 'CA'), row(null, null, 'United States'),
  ];
  const fixtures = [...existing, ...MUST_STAY.map(([r]) => r), row('Veenendaal', 'Utrecht', 'Nederland'),
    row('Aurangabad', 'Bihar', 'Bihar'), row('Joliet IL'), row('Brighton', 'CO - US', 'CO - US'),
    row('Mesa', 'AZ: Gilbert/McKellips', 'AZ: Gilbert/McKellips'), row('Zilch UK'),
    row('Kensington Office', 'London', 'London'), row('Florida', null, 'United States'),
    row('Minnesota - Minneapolis'), row('Seoul South'), row('Washington DC Metro Area')];
  for (const r of fixtures) {
    assert.deepEqual(n(r), n(r));
    assert.deepEqual(n({ ...r }), n(r));
    const list = normalizeJobLocations([r]);
    assert.ok(Array.isArray(list) && list.length > 0, JSON.stringify(r));
    assert.deepEqual(normalizeJobLocations([r]), list);
  }
  assert.ok(normalizeJobLocations(fixtures).length > 0);
  assert.equal(normalizeJobLocations(undefined).length, 1);
});
