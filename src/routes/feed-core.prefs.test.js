// Saved preferences on the v2 feed, against a scratch schema (skipped unless TEST_DATABASE_URL is set).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { normalizePrefs } from '../services/feedPrefs.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, cache, exclusions = null, throwExclusions = false;

const get = async (path) => {
  const r = await fetch(base + path, { headers: { authorization: 'Bearer x' } });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const ids = (r) => r.body.jobs.map(j => j.id).sort((a, b) => a - b);
const user = (row, extra = {}) => ({ userId: 'u', dismissed: [], excludedCompanies: [], prefs: normalizePrefs(row), ...extra });

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_prefs_test CASCADE');
  await admin.query('CREATE SCHEMA feed_prefs_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_prefs_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261010000000_geo_place_absorb.sql', import.meta.url), 'utf8').replaceAll('public.', ''));

  // id, country, region, city, title, remote, salary_min. Rows sharing an id are one job in several places.
  const rows = [
    [1, 'US', 'TX', 'Austin', 'Software Engineer', false, 150000],
    [2, 'US', 'TX', 'Dallas', 'Software Engineer', true, null],
    [3, 'US', 'CA', 'San Francisco', 'Sales Intern', false, 50000],
    [4, 'US', 'TX', 'Austin', 'Staff   Engineer ', true, 90000],
    [5, 'GB', '', 'London', 'Designer', true, 200000],
    [6, 'US', 'TX', 'Austin', 'Data Analyst', false, 80000],
    [6, 'DE', '', 'Berlin', 'Data Analyst', false, 80000],   // job 6 is in Austin and Berlin
  ];
  for (const [i, r] of rows.entries()) {
    const [id, cc, rc, city, title, remote, sal] = r;
    if (!rows.slice(0, i).some(x => x[0] === id)) await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, title]);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,salary_min,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,$2,$3,$4,$5, now() - ($6::int * interval '1 minute'), $7,$8,$9,'Acme','acme','https://x',$10,true,true)`,
      [id, cc, rc, city.toLowerCase(), city, id, remote, sal, title, !rows.slice(0, i).some(x => x[0] === id)]);
  }
  // Fresh cache per run so the bypass assertions are meaningful.
  cache = createFeedCache({ redis: null });
  const app = express();
  app.use('/v2', createFeedRouter({
    db: pool, cache,
    getExclusions: async () => { if (throwExclusions) throw new Error('boom'); return exclusions; },
    logger: { warn() {}, error() {} },
  }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA feed_prefs_test CASCADE'); await pool.end(); } });

test('no saved preferences: nothing changes, shared cache path, no prefs marker', { skip }, async () => {
  exclusions = user(null);
  const r = await get('/jobs/feed');
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.body.prefs, undefined);
  assert.notEqual(r.headers.get('x-cache'), 'BYPASS');
});

test('excluded titles: normalised match, also while searching and with prefs=off', { skip }, async () => {
  exclusions = user({ excluded_titles: ['STAFF engineer', 'sales intern'] });
  for (const path of ['/jobs/feed', '/jobs/feed?q=engineer', '/jobs/feed?prefs=off', '/jobs/feed?remote=true']) {
    const r = await get(path);
    assert.ok(!ids(r).includes(4) && !ids(r).includes(3), path);
    assert.equal(r.headers.get('x-cache'), 'BYPASS');
  }
  assert.deepEqual(ids(await get('/jobs/feed')), [1, 2, 5, 6]);
});

test('excluded locations: city, state code, country name; a job with any matching place is dropped', { skip }, async () => {
  exclusions = user({ excluded_locations: ['Berlin'] });
  assert.deepEqual(ids(await get('/jobs/feed?country=US')), [1, 2, 3, 4]);   // job 6 also lives in Berlin
  exclusions = user({ excluded_locations: ['Texas'] });
  assert.deepEqual(ids(await get('/jobs/feed')), [3, 5]);
  exclusions = user({ excluded_locations: ['united kingdom'] });
  assert.deepEqual(ids(await get('/jobs/feed')), [1, 2, 3, 4, 6]);
  exclusions = user({ excluded_locations: ['San Francisco'] });
  assert.deepEqual(ids(await get('/jobs/feed?q=intern')), []);
});

test('soft preferences apply on the default list only; prefs=off skips them', { skip }, async () => {
  exclusions = user({ remote: true, salary_min: 100000 });
  let r = await get('/jobs/feed');
  assert.deepEqual(ids(r), [2, 5]);                  // remote, salary NULL or >= 100000
  assert.equal(r.body.prefs, 'applied');
  assert.equal(r.body.count, 2);
  assert.equal(r.body.countIsCapped, false);
  assert.equal(r.headers.get('x-cache'), 'BYPASS');
  r = await get('/jobs/feed?q=engineer');
  assert.deepEqual(ids(r), [1, 2, 4]);               // search: soft prefs ignored
  assert.equal(r.body.prefs, undefined);
  r = await get('/jobs/feed?prefs=off');
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.body.prefs, 'off');
  assert.equal(r.body.count, 6);
});

test('prefs=off keeps hard exclusions', { skip }, async () => {
  exclusions = user({ remote: true, excluded_titles: ['designer'] });
  assert.deepEqual(ids(await get('/jobs/feed')), [2, 4]);
  const off = await get('/jobs/feed?prefs=off');
  assert.deepEqual(ids(off), [1, 2, 3, 4, 6]);
});

test('count: real filtered count (not place-count minus exclusions) when title/location/soft prefs are active', { skip }, async () => {
  await pool.query('TRUNCATE geo_place');
  await pool.query(`INSERT INTO geo_place (type,label,name_key,country_code,job_count) VALUES ('country','United States','united states','US',999)`);
  exclusions = user({ excluded_titles: ['software engineer'] });
  const r = await get('/jobs/feed?country=US');
  assert.equal(r.body.count, 3);                     // not 999 - something
  exclusions = user({});
  assert.equal((await get('/jobs/feed?country=US')).body.count, 999);   // pure place count still used when nothing applies
});

test('capped count: countIsCapped true past 1000', { skip }, async () => {
  await pool.query(`INSERT INTO job (id) SELECT g FROM generate_series(1000, 2200) g`);
  await pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
     SELECT g,'FR','','paris','Paris', now(), true, 'Chef', 'Acme','acme','https://x',true,true,true FROM generate_series(1000, 2200) g`);
  exclusions = user({ remote: true });
  const r = await get('/jobs/feed?country=FR');
  assert.equal(r.body.count, 1000);
  assert.equal(r.body.countIsCapped, true);
  exclusions = user({ excluded_titles: ['nothing'] });
  assert.equal((await get('/jobs/feed?country=FR')).body.countIsCapped, true);
});

test('fail open: preference trouble serves the unfiltered feed and flags it', { skip }, async () => {
  exclusions = { userId: 'u', dismissed: [], excludedCompanies: [], prefs: null, prefsUnavailable: true };
  const r = await get('/jobs/feed?country=GB');
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), [5]);
  assert.equal(r.headers.get('x-prefs'), 'unavailable');
  throwExclusions = true;
  try {
    const t = await get('/jobs/feed?country=GB');
    assert.equal(t.status, 200);
    assert.equal(t.headers.get('x-exclusions'), 'unavailable');
  } finally { throwExclusions = false; }
});

test('signed-in requests with active preferences never touch the shared cache or L1', { skip }, async () => {
  exclusions = user({ remote: true });
  const before = cache._l1Size();
  for (let i = 0; i < 2; i++) assert.equal((await get('/jobs/feed?country=GB')).headers.get('x-cache'), 'BYPASS');
  assert.equal(cache._l1Size(), before);
});
