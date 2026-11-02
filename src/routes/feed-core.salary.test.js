// Minimum-salary filter on the v2 feed, against a scratch schema (skipped unless TEST_DATABASE_URL is set).
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
let pool, server, base, exclusions = null;

const get = async (path, auth = false) => {
  const r = await fetch(base + path, { headers: auth ? { authorization: 'Bearer x' } : {} });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const ids = (r) => r.body.jobs.map(j => j.id).sort((a, b) => a - b);

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_salary_test CASCADE');
  await admin.query('CREATE SCHEMA feed_salary_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_salary_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261010000000_geo_place_absorb.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  // id, salary_min, currency. Job 1 is the newest (sort_at = now - id minutes).
  const rows = [
    [1, 150000, 'USD'],
    [2, null, null],        // no salary listed
    [3, 90000, null],       // currency unknown: treated as dollars
    [4, 120000, 'EUR'],     // other currency: not comparable to dollars
    [5, 200000, 'USD'],
    [6, 100000, 'USD'],     // exactly the threshold
  ];
  for (const [id, sal, cur] of rows) {
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, `Engineer ${id}`]);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,salary_min,salary_currency,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
       VALUES ($1::int,'US','TX','austin','Austin', now() - ($1::int * interval '1 minute'), false, $2, $3, $4, 'Acme','acme','https://x',true,true,true)`,
      [id, sal, cur, `Engineer ${id}`]);
  }
  await pool.query(`INSERT INTO geo_place (type,label,name_key,country_code,job_count) VALUES ('country','United States','united states','US',999)`);
  const app = express();
  app.use('/v2', createFeedRouter({
    db: pool, cache: createFeedCache({ redis: null }),
    getExclusions: async () => exclusions,
    logger: { warn() {}, error() {} },
  }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA feed_salary_test CASCADE'); await pool.end(); } });

test('no filter: everything, and the precomputed place count is still used', { skip }, async () => {
  const r = await get('/jobs/feed?country=US');
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.body.count, 999);
});

test('salary_min keeps jobs whose stated floor is at or above it, in dollars; unlisted and other currencies drop out', { skip }, async () => {
  assert.deepEqual(ids(await get('/jobs/feed?country=US&salary_min=100000')), [1, 5, 6]);
  assert.deepEqual(ids(await get('/jobs/feed?country=US&salary_min=150000')), [1, 5]);
  assert.deepEqual(ids(await get('/jobs/feed?country=US&salary_min=200000')), [5]);
  assert.deepEqual(ids(await get('/jobs/feed?country=US&salary_min=90000')), [1, 3, 5, 6]);
  assert.deepEqual(ids(await get('/jobs/feed?salary_min=300000')), []);   // worldwide too
});

test('count is the real filtered count, not the place count', { skip }, async () => {
  const r = await get('/jobs/feed?country=US&salary_min=150000');
  assert.equal(r.body.count, 2);
  assert.equal(r.body.countIsCapped, false);
});

test('pagination with a cursor walks the filtered list once, no duplicates or gaps', { skip }, async () => {
  const seen = [];
  let path = '/jobs/feed?country=US&salary_min=100000&limit=1';
  for (let i = 0; i < 5; i++) {
    const r = await get(path);
    assert.equal(r.status, 200);
    seen.push(...r.body.jobs.map(j => j.id));
    if (!r.body.nextCursor) break;
    path = `/jobs/feed?country=US&salary_min=100000&limit=1&cursor=${r.body.nextCursor}`;
  }
  assert.deepEqual(seen, [1, 5, 6]);   // newest first
});

test('different salary values never share a cached page', { skip }, async () => {
  const a = await get('/jobs/feed?country=US&salary_min=150000');
  const b = await get('/jobs/feed?country=US&salary_min=100000');
  const c = await get('/jobs/feed?country=US&salary_min=150000');
  assert.deepEqual(ids(a), [1, 5]);
  assert.deepEqual(ids(b), [1, 5, 6]);
  assert.deepEqual(ids(c), [1, 5]);
});

test('invalid values are a 400', { skip }, async () => {
  for (const v of ['abc', '95000', '0', '600000', '-1', '100000.5']) {
    const r = await get(`/jobs/feed?country=US&salary_min=${encodeURIComponent(v)}`);
    assert.equal(r.status, 400, v);
    assert.deepEqual(r.body, { error: 'invalid salary_min' });
  }
});

test('a signed-in user with a saved salary preference: the explicit filter replaces the saved one', { skip }, async () => {
  exclusions = { userId: 'u', dismissed: [], excludedCompanies: [], prefs: normalizePrefs({ salary_min: 140000 }) };
  const dflt = await get('/jobs/feed?country=US', true);
  assert.deepEqual(ids(dflt), [1, 2, 5]);                 // saved preference: unknown or >= 140000
  const explicit = await get('/jobs/feed?country=US&salary_min=100000', true);
  assert.deepEqual(ids(explicit), [1, 5, 6]);             // the explicit number rules; unlisted pay is out, 100000 is in
  exclusions = null;
});
