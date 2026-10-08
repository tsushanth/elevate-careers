// Regionless-absorb, junk-city filter and suggestion ordering.
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from '../routes/feed-core.js';
import { createFeedCache } from './feedCache.js';
import { rebuildGeoPlaces, suggestPlaces, isAbsorbing, isJunkCity, isDominant, clearAbsorbCache } from './geoPlace.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base;
const get = async (path) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };

let nextId = 1;
const add = (cc, rc, city, minutes) => {
  const id = nextId++;
  return pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
     VALUES ($1,$2,$3,$4,$5, date_trunc('milliseconds', now()) - ($6::int * interval '1 minute'),'t','c','c','https://x',true,true,true)`,
    [id, cc, rc, city.toLowerCase(), city, minutes ?? id]).then(() => id);
};
const many = async (n, cc, rc, city) => { for (let i = 0; i < n; i++) await add(cc, rc, city); };

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS geo_absorb_test CASCADE');
  await admin.query('CREATE SCHEMA geo_absorb_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=geo_absorb_test' });
  for (const f of ['20261008000000_job_feed', '20261010000000_geo_place_absorb']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/migrations/${f}.sql`, import.meta.url), 'utf8').replaceAll('public.', ''));
  }
  // San Francisco: dominant CA (18 + 1 TX = 5%), interleaved with 6 regionless rows.
  for (let i = 0; i < 12; i++) { await add('US', 'CA', 'San Francisco'); if (i % 2 === 0) await add('US', '', 'San Francisco'); }
  await many(6, 'US', 'CA', 'San Francisco');
  await many(1, 'US', 'TX', 'San Francisco');
  await many(4, 'US', 'CA', 'San Diego'); await many(2, 'US', '', 'San Diego');
  // Springfield: ambiguous (IL 60%, MO 40%).
  await many(6, 'US', 'IL', 'Springfield'); await many(4, 'US', 'MO', 'Springfield'); await many(3, 'US', '', 'Springfield');
  // 80% share but a second region at 20% (> 10%): not dominant.
  await many(8, 'US', 'WA', 'Bellevue'); await many(2, 'US', 'NE', 'Bellevue'); await many(3, 'US', '', 'Bellevue');
  // Regionless-only city stays as is.
  await many(3, 'US', '', 'Nowhere');
  // Junk and legitimate hyphen/period names.
  await many(5, 'US', 'CA', 'California - San Francisco Bay Area');
  await many(4, 'US', 'NY', 'NY office');
  await many(3, 'US', 'NC', 'Winston-Salem'); await many(3, 'US', 'MO', 'St. Louis'); await many(3, 'US', 'ID', "Coeur d'Alene");
  await many(3, 'US', 'DC', 'Washington, D.C.');
  // Ordering: "ca" -> Canada, California, then cities.
  await many(3, 'CA', 'ON', 'Toronto'); await many(40, 'US', 'NC', 'Cary'); await many(5, 'US', 'CA', 'Los Angeles');
  // A job with both a regionless and a CA row for Palo Alto is returned once.
  const dup = nextId++;
  for (const rc of ['CA', '']) {
    await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
      VALUES ($1,'US',$2,'palo alto','Palo Alto', date_trunc('milliseconds', now()), 't','c','c','https://x',true,true,true)`, [dup, rc]);
  }
  await many(4, 'US', 'CA', 'Palo Alto');
  await rebuildGeoPlaces(pool);

  const app = express();
  app.use('/v2', createFeedRouter({ db: pool, cache: createFeedCache({ redis: null }), getExclusions: async () => null }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA geo_absorb_test CASCADE'); await pool.end(); } });

test('isJunkCity: drops scraped labels, keeps real names', () => {
  for (const n of ['California - San Francisco Bay Area', 'Massachusetts - Boston', 'NY office', 'NYC', 'SF Office', 'US TX Austin',
    'Remote - U.S.', 'Pangyo (Software Dream Center)', '590 Eureka Ave', 'Ontario: Toronto', 'a|b', 'a;b', 'x'.repeat(41), 'Texas - Austin'])
    assert.equal(isJunkCity(n), true, n);
  for (const n of ['St. Louis', "Coeur d'Alene", 'Winston-Salem', 'Washington, D.C.', 'San Francisco', 'New York', 'Baden-Baden', 'Mc Lean', 'Washington'])
    assert.equal(isJunkCity(n), false, n);
});

test('isDominant thresholds: >=80% top and no other region >10%', () => {
  assert.equal(isDominant([18, 1]), true);
  assert.equal(isDominant([8, 2]), false);   // second is 20%
  assert.equal(isDominant([6, 4]), false);
  assert.equal(isDominant([80, 10, 10]), true);  // bounds are inclusive
  assert.equal(isDominant([79, 11, 10]), false);
  assert.equal(isDominant([100]), true);
  assert.equal(isDominant([]), false);
});

test('dominant city absorbs: suggestion count equals the result set, regionless entry not listed', { skip }, async () => {
  const { rows } = await pool.query(`SELECT label, job_count, absorbs_regionless FROM geo_place WHERE name_key = 'san francisco'`);
  assert.deepEqual(rows.map(r => [r.label, r.job_count, r.absorbs_regionless]), [['San Francisco, California, United States', 24, true]]);
});

test('feed for the absorbing pick returns CA + regionless rows and the count matches', { skip }, async () => {
  const sug = (await get('/geo/suggest?q=san%20f')).body.places;
  assert.equal(sug.length, 1);
  const total = sug[0].count;
  const all = []; let cursor = '';
  let first;
  for (let i = 0; i < 20; i++) {
    const r = await get(`/jobs/feed?country=US&region=CA&city=San%20Francisco&limit=7${cursor ? '&cursor=' + cursor : ''}`);
    assert.equal(r.status, 200);
    if (!first) first = r.body;
    all.push(...r.body.jobs);
    if (!r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  assert.equal(first.count, total);
  assert.equal(all.length, total);
  assert.equal(new Set(all.map(j => j.id)).size, all.length, 'no duplicates across pages');
  assert.ok(all.some(j => j.region_code === '') && all.some(j => j.region_code === 'CA'));
  assert.ok(!all.some(j => j.region_code === 'TX'));
  const times = all.map(j => new Date(j.posted_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'ordered by sort_at desc across the OR');
});

test('count with filters equals the result set too (count query uses the same predicate)', { skip }, async () => {
  const r = await get('/jobs/feed?country=US&region=CA&city=San%20Francisco&days=30&limit=50');
  assert.equal(r.body.count, r.body.jobs.length);
  assert.equal(r.body.count, 24);
});

test('a job with a regionless and a regioned row for the city is returned once', { skip }, async () => {
  const r = await get('/jobs/feed?country=US&region=CA&city=Palo%20Alto&limit=50');
  assert.equal(r.body.jobs.length, 5);
  assert.equal(new Set(r.body.jobs.map(j => j.id)).size, 5);
  const s = (await get('/geo/suggest?q=palo')).body.places;
  assert.equal(s[0].count, 5);
});

test('ambiguous cities do not absorb; regionless stays its own entry', { skip }, async () => {
  const s = (await get('/geo/suggest?q=springfield')).body.places;
  assert.deepEqual(s.map(p => [p.label, p.count]).sort(), [
    ['Springfield, United States', 3], ['Springfield, Illinois, United States', 6], ['Springfield, Missouri, United States', 4]].sort());
  const il = await get('/jobs/feed?country=US&region=IL&city=Springfield&limit=50');
  assert.equal(il.body.jobs.length, 6);
  assert.ok(il.body.jobs.every(j => j.region_code === 'IL'));
  const none = await get('/jobs/feed?country=US&city=Springfield&limit=50');
  assert.equal(none.body.jobs.length, 3);
  const b = (await get('/geo/suggest?q=bellevue')).body.places;
  assert.deepEqual(b.map(p => p.label).sort(), ['Bellevue, United States', 'Bellevue, Washington, United States']); // 80/20 split is ambiguous; NE (2 jobs) is below the minimum
});

test('a regionless-only city is untouched', { skip }, async () => {
  const s = (await get('/geo/suggest?q=nowhere')).body.places;
  assert.deepEqual(s.map(p => [p.label, p.count]), [['Nowhere, United States', 3]]);
});

test('junk city entries are not listed; legitimate punctuation survives', { skip }, async () => {
  const { rows } = await pool.query(`SELECT label FROM geo_place WHERE type = 'city'`);
  const labels = rows.map(r => r.label);
  assert.ok(!labels.some(l => /Bay Area|NY office/.test(l)), labels.join('|'));
  for (const n of ['Winston-Salem', 'St. Louis', "Coeur d'Alene", 'Washington, D.C.']) assert.ok(labels.some(l => l.startsWith(n)), n);
});

test('suggestions rank country, then state, then city by count; normal queries unchanged', { skip }, async () => {
  const ca = (await suggestPlaces(pool, 'ca')).map(p => p.label);
  assert.equal(ca[0], 'Canada');
  assert.equal(ca[1], 'California, United States');
  assert.ok(ca.indexOf('Cary, North Carolina, United States') > 1);
  const san = (await suggestPlaces(pool, 'san')).map(p => p.label);
  assert.deepEqual(san, ['San Francisco, California, United States', 'San Diego, California, United States']);
});

test('lookup failure fails open to the strict region match', { skip }, async () => {
  const flaky = { query: (text, v) => (/absorbs_regionless FROM geo_place/.test(text) ? Promise.reject(new Error('boom')) : pool.query(text, v)) };
  assert.equal(await isAbsorbing(flaky, { country: 'US', region: 'CA', city: 'San Francisco' }), false);
  const app = express();
  app.use('/v2', createFeedRouter({ db: flaky, cache: createFeedCache({ redis: null }), getExclusions: async () => null }));
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${srv.address().port}/v2/jobs/feed?country=US&region=CA&city=San%20Francisco&limit=50`)).json();
    assert.equal(r.jobs.length, 18);
    assert.ok(r.jobs.every(j => j.region_code === 'CA'));
  } finally { srv.close(); }
});

test('absorb lookup is cached ~60 s and re-read afterwards', { skip }, async () => {
  let calls = 0;
  const db = { query: (t, v) => { calls++; return pool.query(t, v); } };
  const p = { country: 'US', region: 'CA', city: 'San Francisco' };
  const t0 = 1_000_000;
  assert.equal(await isAbsorbing(db, p, t0), true);
  assert.equal(await isAbsorbing(db, p, t0 + 59_000), true);
  assert.equal(calls, 1);
  await isAbsorbing(db, p, t0 + 61_000);
  assert.equal(calls, 2);
  clearAbsorbCache(db);
});
