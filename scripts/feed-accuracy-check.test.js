import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreement, parseCsv } from './feed-accuracy-check.js';

test('parseCsv reads quoted fields and ignores blank lines', () => {
  const rows = parseCsv('city,region,country,label_country,label_region\n"San Francisco, CA",CA,CA,US,CA\n\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'San Francisco, CA');
  assert.equal(rows[0].label_country, 'US');
});

test('agreement scores country and region against the hand labels', () => {
  const rows = [
    { city: 'Austin', region: 'TX', country: 'TX', label_country: 'US', label_region: 'TX' },   // match
    { city: 'London', region: '', country: 'UK', label_country: 'GB', label_region: '' },        // match
    { city: 'Pune', region: '', country: 'IN', label_country: 'IN', label_region: '' },          // match
    { city: 'Springfield', region: '', country: '', label_country: 'US', label_region: 'IL' },   // ZZ vs US: miss
  ];
  const r = agreement(rows);
  assert.equal(r.total, 4);
  assert.equal(r.matched, 3);
  assert.equal(r.pct, 75);
});

test('a row labelled ZZ matches when the normaliser also says ZZ', () => {
  const r = agreement([{ city: '', region: '', country: 'Full-time', label_country: 'ZZ', label_region: '' }]);
  assert.equal(r.pct, 100);
});
