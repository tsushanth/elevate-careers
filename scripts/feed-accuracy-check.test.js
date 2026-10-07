import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agreement, parseCsv } from './feed-accuracy-check.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tempFiles = [];
after(() => { for (const f of tempFiles) rmSync(f, { force: true }); });

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

test('parseCsv handles doubled quotes inside quoted fields as literal quotes', () => {
  const rows = parseCsv('city,region\n"Foo ""Bar"", Inc",CA\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'Foo "Bar", Inc');
  assert.equal(rows[0].region, 'CA');
});

test('CLI exits 0 when all rows labelled and agreement >= 95%', () => {
  const csv = 'city,region,country,label_country,label_region\n' +
              'Austin,TX,US,US,TX\nLondon,,UK,GB,\n';
  const path = join(tmpdir(), `test-${Date.now()}-all-labelled.csv`);
  tempFiles.push(path);
  writeFileSync(path, csv);
  const result = spawnSync(process.execPath, ['scripts/feed-accuracy-check.js', path], {
    cwd: repoRoot
  });
  assert.equal(result.status, 0, `expected exit 0 but got ${result.status}: stderr=${result.stderr.toString()}`);
});

test('CLI exits 1 when all rows labelled and agreement < 95%', () => {
  // Use rows where normalizer produces mismatches with labels
  // "InvalidCity" with no region/country normalizes to ZZ (unknown)
  const csv = 'city,region,country,label_country,label_region\n' +
              'Austin,TX,US,US,TX\nInvalidCity,InvalidRegion,InvalidCountry,GB,\n';
  const path = join(tmpdir(), `test-${Date.now()}-low-agreement.csv`);
  tempFiles.push(path);
  writeFileSync(path, csv);
  const result = spawnSync(process.execPath, ['scripts/feed-accuracy-check.js', path], {
    cwd: repoRoot
  });
  assert.equal(result.status, 1, `expected exit 1 but got ${result.status}; stdout: ${result.stdout.toString()}`);
});

test('CLI exits 2 with message when any row is unlabelled', () => {
  const csv = 'city,region,country,label_country,label_region\n' +
              'Austin,TX,US,US,TX\nLondon,,UK,,\n';
  const path = join(tmpdir(), `test-${Date.now()}-unlabelled.csv`);
  tempFiles.push(path);
  writeFileSync(path, csv);
  const result = spawnSync(process.execPath, ['scripts/feed-accuracy-check.js', path], {
    cwd: repoRoot
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
  const output = result.stdout.toString() + result.stderr.toString();
  assert.match(output, /unlabelled|1/, 'output should mention unlabelled count');
});

test('CLI exits 2 with message when no file argument provided', () => {
  const result = spawnSync(process.execPath, ['scripts/feed-accuracy-check.js'], {
    cwd: repoRoot
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
  const output = result.stdout.toString() + result.stderr.toString();
  assert.match(output, /usage|file|argument|sample\.csv/i, 'output should show usage');
});
