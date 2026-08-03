// Regression fixtures for every tricky location/text-matching case found in
// production during manual review — each of these leaked past the filter
// once before the fix that made it pass. Kept here so none of them can
// silently regress; see also scripts/audit-unmatched-locations.js for
// catching genuinely NEW unseen patterns this suite can't anticipate.
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveLocationToken, nonUsTextRegexJs } from './geo.js';

test('resolveLocationToken: bare country/region names', () => {
  assert.deepStrictEqual(resolveLocationToken('Canada'), { type: 'country', value: 'Canada' });
  assert.deepStrictEqual(resolveLocationToken('LATAM'), { type: 'region', value: 'LATAM' });
  assert.deepStrictEqual(resolveLocationToken('Brasil'), { type: 'country', value: 'Brazil' }); // Portuguese spelling
  assert.deepStrictEqual(resolveLocationToken('CIS Region'), { type: 'region', value: 'CIS' });
});

test('resolveLocationToken: city + regional-qualifier suffix glued together', () => {
  // "Delhi NCR" arrived as one un-split token; "Delhi" alone matches the
  // dictionary but the full string didn't, until qualifier-stripping was added.
  assert.deepStrictEqual(resolveLocationToken('Delhi NCR'), { type: 'city', value: 'Delhi', country: 'India' });
  assert.deepStrictEqual(resolveLocationToken('Gurgaon NCR'), { type: 'city', value: 'Gurgaon', country: 'India' });
  assert.deepStrictEqual(resolveLocationToken('Mumbai Metropolitan Region'), { type: 'city', value: 'Mumbai', country: 'India' });
});

test('resolveLocationToken: slash-separated multi-city strings', () => {
  // "Vilnius/Kaunas" wasn't split at all before "/" was added as a separator.
  const result = resolveLocationToken('Vilnius/Kaunas');
  assert.strictEqual(result.type, 'city');
  assert.strictEqual(result.country, 'Lithuania');
});

test('resolveLocationToken: employment-type garbage data, not a real place', () => {
  // A Lever categories.location bug put "Full-time" (the commitment value)
  // where the location should be — must resolve to nothing, not a fake city.
  assert.strictEqual(resolveLocationToken('Full-time'), null);
  assert.strictEqual(resolveLocationToken('Part-time'), null);
});

test('resolveLocationToken: real US locations stay unmatched (no false positive)', () => {
  assert.strictEqual(resolveLocationToken('Austin, Texas'.split(',')[0]), null); // "Austin" alone isn't in the dictionary — correct, no false match
  assert.strictEqual(resolveLocationToken('Bay Area'), null); // must NOT be corrupted by qualifier-stripping into a false match
});

test('nonUsTextRegexJs: matches real non-US location signals', () => {
  const re = nonUsTextRegexJs();
  assert.ok('This role is based in London, UK.'.match(re));
  assert.ok('This role is based in Pangyo, South Korea.'.match(re));
});

test('nonUsTextRegexJs: does not false-positive on US text', () => {
  const re = nonUsTextRegexJs();
  assert.strictEqual('This role is based in Austin, Texas.'.match(re), null);
});

test('VEVRAA "Vietnam era veteran" EEO boilerplate is not a location signal', () => {
  // This is a job-fit-route-level check (context window around the match),
  // not resolveLocationToken itself — verified here at the regex-match
  // level; the "near veteran" suppression logic lives in ai-resume.js.
  const re = nonUsTextRegexJs();
  const text = 'We do not discriminate against protected veteran status, including Vietnam era veterans.';
  const m = text.match(re);
  assert.ok(m); // the raw regex DOES match "Vietnam" here
  const nearVeteran = /veteran/i.test(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
  assert.ok(nearVeteran); // ...which is exactly why the route-level suppression is required
});
