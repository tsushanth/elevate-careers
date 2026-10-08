// src/services/geoPlace.test.js
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { rebuildGeoPlaces, suggestPlaces, placeCount } from './geoPlace.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;
let insRow;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS geo_place_test CASCADE');
  await admin.query('CREATE SCHEMA geo_place_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2, options: '-c search_path=geo_place_test' });
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261010000000_geo_place_absorb.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  const ins = insRow = (id, cc, rc, city) => pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url,is_active,is_primary,is_country_primary,is_region_primary)
     VALUES ($1,$2,$3,$4,$5,now(),'t','c','https://x',true,$6,$7,$8)`,
    [id, cc, rc, (city || '').toLowerCase(), city, true, true, true]);
  // 4 jobs in Austin TX, 3 in Dallas TX, 3 in Toronto ON, 1 unknown, 3 in Berlin
  for (let i = 1; i <= 4; i++) await ins(i, 'US', 'TX', 'Austin');
  for (let i = 5; i <= 7; i++) await ins(i, 'US', 'TX', 'Dallas');
  for (let i = 8; i <= 10; i++) await ins(i, 'CA', 'ON', 'Toronto');
  await ins(11, 'ZZ', '', null);
  for (let i = 12; i <= 14; i++) await ins(i, 'DE', '', 'Berlin');
  await rebuildGeoPlaces(pool);
});

after(async () => { if (pool) { await pool.query('DROP SCHEMA geo_place_test CASCADE'); await pool.end(); } });

test('rebuild creates countries, states and cities with counts; ZZ is not a place', { skip }, async () => {
  const { rows } = await pool.query('SELECT type, label, job_count FROM geo_place ORDER BY type, label');
  const by = Object.fromEntries(rows.map(r => [`${r.type}:${r.label}`, r.job_count]));
  assert.equal(by['country:United States'], 7);
  assert.equal(by['country:Germany'], 3);
  assert.equal(by['state:Texas, United States'], 7);
  assert.equal(by['city:Austin, Texas, United States'], 4);
  assert.equal(by['city:Berlin, Germany'], 3);
  assert.ok(!rows.some(r => r.label.includes('ZZ') || r.label === 'Unknown'));
});

test('suggest is prefix-ranked by job count and escapes LIKE wildcards', { skip }, async () => {
  const us = await suggestPlaces(pool, 'uni');
  assert.deepEqual(us.map(p => p.label), ['United States']);
  const t = await suggestPlaces(pool, 'T');
  assert.equal(t[0].label, 'Texas, United States');       // 7 jobs beats Toronto's 3
  assert.deepEqual(await suggestPlaces(pool, '%'), []);   // wildcard is literal, matches nothing
  assert.deepEqual(await suggestPlaces(pool, '_'), []);
  assert.deepEqual(await suggestPlaces(pool, ''), []);
});

test('placeCount returns the precomputed count or null', { skip }, async () => {
  assert.equal(await placeCount(pool, { country: 'US', region: '', city: '' }), 7);
  assert.equal(await placeCount(pool, { country: 'US', region: 'TX', city: '' }), 7);
  assert.equal(await placeCount(pool, { country: 'US', region: 'TX', city: 'austin' }), 4);
  assert.equal(await placeCount(pool, { country: 'FR', region: '', city: '' }), null);
});

const counts = async () => {
  const { rows } = await pool.query('SELECT type, label, job_count FROM geo_place');
  return Object.fromEntries(rows.map(r => [`${r.type}:${r.label}`, r.job_count]));
};

test('rebuild removes places whose jobs went away and never empties the table', { skip }, async () => {
  await pool.query('UPDATE job_feed SET is_active = false WHERE country_code = $1', ['DE']);
  try {
    await rebuildGeoPlaces(pool);
    const by = await counts();
    assert.ok(!('country:Germany' in by));
    assert.ok(!('city:Berlin, Germany' in by));
    assert.equal(by['country:United States'], 7);
    assert.equal(by['city:Austin, Texas, United States'], 4);
    assert.ok(Object.keys(by).length > 0);
  } finally {
    await pool.query('UPDATE job_feed SET is_active = true WHERE country_code = $1', ['DE']);
    await rebuildGeoPlaces(pool);
  }
  assert.equal((await counts())['country:Germany'], 3);
});

test('rebuild is independent of the Node clock (skewed ahead or behind)', { skip }, async () => {
  const RealDate = Date;
  for (const offset of [3600e3, -3600e3]) {
    globalThis.Date = class extends RealDate {
      constructor(...a) { a.length ? super(...a) : super(RealDate.now() + offset); }
      static now() { return RealDate.now() + offset; }
    };
    try { await rebuildGeoPlaces(pool); } finally { globalThis.Date = RealDate; }
    const by = await counts();
    assert.equal(by['country:United States'], 7, `offset ${offset}`);
    assert.equal(by['country:Germany'], 3, `offset ${offset}`);
  }
});

test('small cities are not places but still count in state and country; inactive jobs are not counted; multi-city jobs count once', { skip }, async () => {
  const cleanup = () => pool.query('DELETE FROM job_feed WHERE job_id >= 100');
  try {
    await insRow(100, 'US', 'TX', 'Tiny');      // (b) 2 jobs in Tiny TX: below the city threshold
    await insRow(101, 'US', 'TX', 'Tiny');
    await insRow(102, 'US', 'TX', 'Austin');    // (c) inactive job in Austin
    await pool.query('UPDATE job_feed SET is_active = false WHERE job_id = 102');
    await insRow(103, 'US', 'TX', 'Austin');    // (d) one job listed in two TX cities
    await insRow(103, 'US', 'TX', 'Houston');
    await rebuildGeoPlaces(pool);
    const by = await counts();
    assert.ok(!('city:Tiny, Texas, United States' in by));
    // 7 base + 2 Tiny + 1 multi-city job (counted once); inactive excluded
    assert.equal(by['state:Texas, United States'], 10);
    assert.equal(by['country:United States'], 10);
    assert.equal(by['city:Austin, Texas, United States'], 5); // 4 + job 103 (inactive 102 excluded)
    assert.ok(!('city:Houston, Texas, United States' in by)); // only 1 job
  } finally {
    await cleanup();
    await rebuildGeoPlaces(pool);
  }
  const by = await counts();
  assert.equal(by['state:Texas, United States'], 7);
  assert.equal(by['city:Austin, Texas, United States'], 4);
});
