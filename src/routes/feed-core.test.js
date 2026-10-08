// src/routes/feed-core.test.js
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { rebuildGeoPlaces } from '../services/geoPlace.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, exclusions = null;

const get = async (path, headers = {}) => {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_core_test CASCADE');
  await admin.query('CREATE SCHEMA feed_core_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_core_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261010000000_geo_place_absorb.sql', import.meta.url), 'utf8').replaceAll('public.', ''));

  // 60 US jobs (30 in Austin, 30 in Dallas), 5 remote, 10 UK, 3 unknown.
  // Newest first by id; the unknown-location jobs are the newest of all (minutes: 0).
  const add = async (id, cc, rc, city, over = {}) => {
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, over.title || 'Software Engineer']);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,
         autofill_ready,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,$2,$3,$4,$5, now() - ($10::int * interval '1 minute'), $6, $7, $8, $9, 'https://boards.greenhouse.io/x/' || ($1::bigint)::text, true, true, true, true)`,
      [id, cc, rc, (city || '').toLowerCase(), city, over.remote || false, over.title || 'Software Engineer', over.company || 'Acme', over.key || 'acme', over.minutes ?? id]);
  };
  for (let i = 1; i <= 30; i++) await add(i, 'US', 'TX', 'Austin', { remote: i <= 5 });
  for (let i = 31; i <= 60; i++) await add(i, 'US', 'TX', 'Dallas', { company: 'Globex', key: 'globex' });
  for (let i = 61; i <= 70; i++) await add(i, 'GB', '', 'London', { title: 'Designer' });
  for (let i = 71; i <= 73; i++) await add(i, 'ZZ', '', null, { minutes: 0 });
  await rebuildGeoPlaces(pool);

  const app = express();
  app.use('/v2', createFeedRouter({
    db: pool,
    cache: createFeedCache({ redis: null }),
    getExclusions: async () => exclusions,
  }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA feed_core_test CASCADE'); await pool.end(); } });

test('country feed: 25 per page, newest first, country name included', { skip }, async () => {
  const r = await get('/jobs/feed?country=US');
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs.length, 25);
  assert.equal(r.body.jobs[0].id, 1);
  assert.equal(r.body.jobs[0].country, 'United States');
  assert.ok(r.body.nextCursor);
  assert.equal(r.body.count, 60);          // from geo_place for a place-only query
  assert.equal(r.body.countIsCapped, false);
});

test('keyset pagination: no duplicates or gaps, even when a newer job arrives between pages', { skip }, async () => {
  const p1 = await get('/jobs/feed?country=US&limit=10');
  // A brand new job is ingested after the first page was served.
  await pool.query('INSERT INTO job (id, tsv) VALUES (999, to_tsvector(\'english\', \'new\'))');
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url,is_primary,is_country_primary,is_region_primary)
                    VALUES (999,'US','TX','austin','Austin', now() + interval '1 hour','New','Acme','https://x',true,true,true)`);
  const p2 = await get(`/jobs/feed?country=US&limit=10&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
  const ids = [...p1.body.jobs, ...p2.body.jobs].map(j => j.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(!ids.includes(999));
  await pool.query('DELETE FROM job_feed WHERE job_id = 999');
  await pool.query('DELETE FROM job WHERE id = 999');
});

test('last page has no cursor', { skip }, async () => {
  const r = await get('/jobs/feed?country=GB&limit=25');
  assert.equal(r.body.jobs.length, 10);
  assert.equal(r.body.nextCursor, null);
});

test('state and city filters; remote toggle; unknown jobs only appear worldwide', { skip }, async () => {
  assert.equal((await get('/jobs/feed?country=US&region=TX&city=dallas&limit=50')).body.jobs.length, 30);
  const remote = await get('/jobs/feed?country=US&remote=true');
  assert.equal(remote.body.jobs.length, 5);
  assert.equal(remote.body.countIsCapped, false);
  const worldwide = await get('/jobs/feed?limit=50');
  assert.ok(worldwide.body.jobs.some(j => j.country_code === 'ZZ'));
  const us = await get('/jobs/feed?country=US&limit=50');
  assert.ok(!us.body.jobs.some(j => j.country_code === 'ZZ'));
});

test('keyword filter', { skip }, async () => {
  const r = await get('/jobs/feed?q=designer&limit=50');
  assert.equal(r.body.jobs.length, 10);
});

test('empty and invalid input', { skip }, async () => {
  const empty = await get('/jobs/feed?country=FR');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.jobs, []);
  assert.equal(empty.body.nextCursor, null);
  assert.equal((await get('/jobs/feed?country=USA')).status, 400);
  assert.equal((await get('/jobs/feed?cursor=garbage')).status, 400);
});

test('signed-in exclusions apply and bypass the shared cache', { skip }, async () => {
  const anon = await get('/jobs/feed?country=US&limit=3');
  assert.deepEqual(anon.body.jobs.map(j => j.id), [1, 2, 3]);
  exclusions = { userId: 'u1', dismissed: [1], excludedCompanies: [] };
  const mine = await get('/jobs/feed?country=US&limit=3', { authorization: 'Bearer x' });
  assert.deepEqual(mine.body.jobs.map(j => j.id), [2, 3, 4]);
  exclusions = { userId: 'u1', dismissed: [], excludedCompanies: ['acme'] };
  const noAcme = await get('/jobs/feed?country=US&limit=3', { authorization: 'Bearer x' });
  assert.deepEqual(noAcme.body.jobs.map(j => j.id), [31, 32, 33]);
  exclusions = null;
  const again = await get('/jobs/feed?country=US&limit=3');
  assert.deepEqual(again.body.jobs.map(j => j.id), [1, 2, 3]);
});

test('suggest and stats', { skip }, async () => {
  const s = await get('/geo/suggest?q=uni');
  assert.deepEqual(s.body.places.map(p => p.label), ['United States', 'United Kingdom']);
  assert.deepEqual((await get('/geo/suggest?q=%25')).body.places, []);
  const st = await get('/stats');
  assert.equal(st.body.jobs, 73);
  assert.equal(st.body.remote, 5);
});

const serve = async (router) => {
  const app = express();
  app.use('/v2', router);
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  return { srv, b: `http://127.0.0.1:${srv.address().port}/v2` };
};

test('geo suggest 500 is not publicly cacheable and is logged', { skip }, async () => {
  const errors = [];
  const { srv, b } = await serve(createFeedRouter({
    db: { query: async () => { throw new Error('db down'); } },
    cache: createFeedCache({ redis: null }),
    getExclusions: async () => null,
    logger: { warn() {}, error: (...a) => errors.push(a) },
  }));
  try {
    const r = await fetch(b + '/geo/suggest?q=uni');
    assert.equal(r.status, 500);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0].error, 'db down');
    const ok = await get('/geo/suggest?q=uni');
    assert.equal(ok.headers.get('cache-control'), 'public, max-age=300');
  } finally { srv.close(); }
});

test('feed 500 is logged with a generic response', { skip }, async () => {
  const errors = [];
  const { srv, b } = await serve(createFeedRouter({
    db: { query: async () => { throw new Error('db down'); } },
    cache: createFeedCache({ redis: null }),
    getExclusions: async () => null,
    logger: { warn() {}, error: (...a) => errors.push(a) },
  }));
  try {
    const r = await fetch(b + '/jobs/feed?country=US');
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'Failed to load jobs' });
    assert.equal(errors.length, 1);
  } finally { srv.close(); }
});

test('getExclusions failure falls back to the anonymous feed', { skip }, async () => {
  const warns = [];
  const cache = createFeedCache({ redis: null });
  const keys = [];
  const spy = { ...cache, getOrLoad: (k, l) => { keys.push(k); return cache.getOrLoad(k, l); } };
  const { srv, b } = await serve(createFeedRouter({
    db: pool, cache: spy,
    getExclusions: async () => { throw new Error('auth backend down'); },
    logger: { warn: (...a) => warns.push(a), error() {} },
  }));
  try {
    const r = await fetch(b + '/jobs/feed?country=US&limit=3', { headers: { authorization: 'Bearer x' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-exclusions'), 'unavailable');
    assert.notEqual(r.headers.get('x-cache'), 'BYPASS');
    assert.deepEqual((await r.json()).jobs.map(j => j.id), [1, 2, 3]);
    assert.equal(keys.length, 1);
    assert.ok(!keys[0].includes('u1'));
    assert.equal(warns.length, 1);
    assert.equal(warns[0][0].error, 'auth backend down');
  } finally { srv.close(); }
});

test('city without region is the unregioned city only; a dominant region also absorbs the regionless rows (once per job)', { skip }, async () => {
  const ins = async (id, rc) => {
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', \'x\'))', [id]);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,'CA',$2,'toronto','Toronto', now() - ($3::int * interval '1 minute'),'T','Acme','https://x',true,true,true)`, [id, rc, id]);
  };
  await ins(501, 'ON'); await ins(502, ''); await ins(503, 'ON');
  // job 502 exists once in the unregioned city; a job with both rows must appear once per query
  await ins(504, 'ON');
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,apply_url)
                    VALUES (504,'CA','','toronto','Toronto', now() - interval '504 minutes','T','Acme','https://x')`);
  await rebuildGeoPlaces(pool);
  const bare = await get('/jobs/feed?country=CA&city=Toronto&limit=50');
  assert.deepEqual(bare.body.jobs.map(j => j.id).sort(), [502, 504]);
  assert.equal(bare.body.count, 2);
  const on = await get('/jobs/feed?country=CA&region=ON&city=Toronto&limit=50');
  // Toronto is all-ON among regioned rows, so the ON pick also covers the regionless 502; 504 (both rows) once.
  assert.deepEqual(on.body.jobs.map(j => j.id).sort(), [501, 502, 503, 504]);
  assert.equal(on.body.count, 4);
  await pool.query('DELETE FROM job_feed WHERE job_id >= 501');
  await pool.query('DELETE FROM job WHERE id >= 501');
  await rebuildGeoPlaces(pool);
});

test('signed-in count is exact: no exclusions equals shared count; inside/outside the filter; overlap; beyond the 1000 cap', { skip }, async () => {
  const auth = { authorization: 'Bearer x' };
  const count = async (path) => (await get(path, auth)).body;
  // no exclusions -> same as the anonymous (shared, cached) count
  exclusions = { userId: 'u2', dismissed: [], excludedCompanies: [] };
  const anon = (await get('/jobs/feed?country=US')).body;
  assert.equal((await count('/jobs/feed?country=US')).count, anon.count);
  // dismissed inside the filter, one outside (GB job 61), one that does not exist
  exclusions = { userId: 'u2', dismissed: [1, 2, 61, 99999], excludedCompanies: [] };
  assert.equal((await count('/jobs/feed?country=US')).count, 58);
  assert.equal((await count('/jobs/feed?country=GB')).count, 9);
  // a company and a dismissed job of that company are not double counted
  exclusions = { userId: 'u2', dismissed: [1, 31], excludedCompanies: ['acme'] };
  assert.equal((await count('/jobs/feed?country=US')).count, 29);
  assert.equal((await count('/jobs/feed?country=US&region=TX&city=dallas')).count, 29);
  assert.equal((await count('/jobs/feed?country=US&region=TX&city=austin')).count, 0);
  // beyond the cap: 1,200 jobs in IT; one dismissed -> exactly 1199, not "1,000+"
  await pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,title,company_name,company_key,apply_url,is_country_primary)
     SELECT 1000+g,'IT','','rome','Rome', now() - (g * interval '1 second'),'Dev','Fiat','fiat','https://x/' || g, true FROM generate_series(1,1200) g`);
  await rebuildGeoPlaces(pool);
  exclusions = { userId: 'u2', dismissed: [1001], excludedCompanies: [] };
  const it = await count('/jobs/feed?country=IT');
  assert.equal(it.count, 1199);
  assert.equal(it.countIsCapped, false);
  // a list over the limit falls back to the capped count
  exclusions = { userId: 'u2', dismissed: Array.from({ length: 5001 }, (_, i) => 500000 + i), excludedCompanies: [] };
  const big = await count('/jobs/feed?country=IT');
  assert.equal(big.count, 1000);
  assert.equal(big.countIsCapped, true);
  exclusions = null;
});
