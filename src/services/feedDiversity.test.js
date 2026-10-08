// src/services/feedDiversity.test.js
// Company-diversity ordering (job_feed.company_rank / feed_at). Integration test against a
// real Postgres; skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from '../routes/feed-core.js';
import { createFeedCache } from './feedCache.js';
import { syncJobFeedBatch, syncJobFeed, deactivateInFeed, recomputeCompanyRank } from './jobFeed.js';
import { encodeCursor, decodeCursor, feedCacheKey, feedOrderMode } from './feedQuery.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
const STEP_MS = 6 * 3_600_000; // the 6 h penalty (feed_rank_step())
const read = (f) => fs.readFileSync(new URL(`../../supabase/${f}`, import.meta.url), 'utf8').replaceAll('public.', '');
let pool, server, base, nextJob = 1;
const NOW = Date.now();

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_div_test CASCADE');
  await admin.query('CREATE SCHEMA feed_div_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 4, options: '-c search_path=feed_div_test' });
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC,
      salary_max NUMERIC, salary_currency TEXT, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true, tsv TSVECTOR);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT REFERENCES job(id), city TEXT, region TEXT, country TEXT, remote BOOLEAN);`);
  for (const f of ['migrations/20261008000000_job_feed.sql', 'migrations/20261010000000_geo_place_absorb.sql',
    'migrations/20261011000000_job_feed_company_rank.sql']) await pool.query(read(f));
});

after(async () => {
  delete process.env.FEED_ORDER;
  if (server) await new Promise(r => server.close(r));
  if (pool) { await pool.query('DROP SCHEMA feed_div_test CASCADE'); await pool.end(); }
});

beforeEach(async () => {
  if (skip) return;
  delete process.env.FEED_ORDER;
  await pool.query('TRUNCATE job_feed, job_location, job, company RESTART IDENTITY CASCADE');
  nextJob = 1;
});

const companyIds = new Map();
async function company(name) {
  if (!companyIds.has(name) || companyIds.get(name).gen !== nextGen) {
    const { rows: [r] } = await pool.query(
      'INSERT INTO company (name, name_normalized) VALUES ($1, $2) RETURNING id', [name, name.toLowerCase()]);
    companyIds.set(name, { id: r.id, gen: nextGen });
  }
  return companyIds.get(name).id;
}
let nextGen = 0;
beforeEach(() => { nextGen++; });

// Insert jobs (all Austin, TX unless locs given) and sync them in one batch. Returns ids.
async function addJobs(specs, { sync = true } = {}) {
  const ids = [];
  for (const s of specs) {
    const cid = await company(s.company);
    const { rows: [j] } = await pool.query(
      `INSERT INTO job (company_id, apply_url, title, posted_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [cid, `https://boards.greenhouse.io/x/${nextJob++}`, s.title || `${s.company} job`, new Date(NOW - s.ageMs).toISOString()]);
    for (const l of s.locs || [{ city: 'Austin', region: 'TX', country: 'US' }]) {
      await pool.query('INSERT INTO job_location (job_id, city, region, country) VALUES ($1,$2,$3,$4)', [j.id, l.city, l.region, l.country]);
    }
    ids.push(Number(j.id));
  }
  if (sync) await syncJobFeedBatch(pool, ids);
  return ids;
}

const MIN = 60_000, HOUR = 3_600_000;
// Resembles the production top-50: one flooder (16) and one runner-up (14) posted in the last
// hour by batch ingests, then 7 small companies (20 jobs) spread over the previous 14 hours.
async function prodLikeDataset() {
  const specs = [];
  for (let i = 0; i < 16; i++) specs.push({ company: 'FlooderA', ageMs: (2 + 2 * i) * MIN });
  for (let i = 0; i < 14; i++) specs.push({ company: 'FlooderB', ageMs: (40 + 4 * i) * MIN });
  const small = ['C', 'D', 'E', 'F', 'G', 'H', 'I'];
  for (let i = 0; i < 20; i++) specs.push({ company: `Small${small[i % 7]}`, ageMs: (60 + 40 * i) * MIN + i * 1000 });
  return addJobs(specs);
}

async function startApp() {
  if (server) await new Promise(r => server.close(r));
  const app = express();
  app.use('/v2', createFeedRouter({ db: pool, cache: createFeedCache({ redis: null }), getExclusions: async () => null }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
}
const get = async (path) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() }; };

async function walk(query, limit) {
  const out = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard++) {
    const r = await get(`/jobs/feed?${query}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(r.status, 200);
    out.push(...r.body.jobs);
    cursor = r.body.nextCursor;
    if (!cursor) return out;
  }
  throw new Error('pagination did not terminate');
}

const perCompany = (jobs) => jobs.reduce((m, j) => m.set(j.company_name, (m.get(j.company_name) || 0) + 1), new Map());
const companyOf = async (ids) => (await pool.query(
  'SELECT j.id, c.name FROM job j JOIN company c ON c.id = j.company_id WHERE j.id = ANY($1)', [ids])).rows;

// Independent oracle: rank each company's jobs newest first, feed_at = sort_at - 6h * (rank - 1).
async function expectedOrder() {
  const { rows } = await pool.query(
    "SELECT job_id, company_key, sort_at FROM job_feed WHERE is_active AND is_primary");
  const byCo = new Map();
  for (const r of rows) { if (!byCo.has(r.company_key)) byCo.set(r.company_key, []); byCo.get(r.company_key).push(r); }
  const scored = [];
  for (const list of byCo.values()) {
    list.sort((a, b) => b.sort_at - a.sort_at || b.job_id - a.job_id);
    list.forEach((r, i) => scored.push({ id: Number(r.job_id), at: r.sort_at.getTime() - Math.min(i, 120) * STEP_MS }));
  }
  scored.sort((a, b) => b.at - a.at || b.id - a.id);
  return scored.map(s => s.id);
}

test('flooding company spreads: first page of 25 has at most 4 jobs per company (was 16)', { skip }, async () => {
  await prodLikeDataset();
  assert.equal((await pool.query('SELECT count(DISTINCT company_key)::int n FROM job_feed')).rows[0].n, 9);

  process.env.FEED_ORDER = 'sort_at';
  await startApp();
  const before = await get('/jobs/feed?country=US&limit=25');
  const maxBefore = Math.max(...perCompany(before.body.jobs).values());
  assert.equal(maxBefore, 16);

  process.env.FEED_ORDER = 'feed_at';
  await startApp();
  const after = await get('/jobs/feed?country=US&limit=25');
  const counts = perCompany(after.body.jobs);
  assert.ok(Math.max(...counts.values()) <= 4, JSON.stringify([...counts]));
  assert.equal(counts.size, 9);
  // Every company's newest job is on the first page; nothing is dropped overall.
  assert.equal((await walk('country=US', 10)).length, 50);
  // Displayed age is still the real posting time.
  const a = after.body.jobs.find(j => j.company_name === 'FlooderA');
  assert.ok(Math.abs(new Date(a.posted_at).getTime() - (NOW - 2 * MIN)) < 5_000);
  assert.equal(after.body.jobs[0].order_key, undefined);
});

for (const mode of ['sort_at', 'feed_at']) {
  test(`pagination in ${mode} mode: no duplicates, no gaps, expected order`, { skip }, async () => {
    await prodLikeDataset();
    process.env.FEED_ORDER = mode;
    await startApp();
    for (const limit of [1, 7, 25, 50]) {
      for (const q of ['country=US', '']) {
        const jobs = await walk(q, limit);
        const ids = jobs.map(j => j.id);
        assert.equal(new Set(ids).size, ids.length, `dup limit=${limit} q=${q}`);
        assert.equal(ids.length, 50, `gap limit=${limit} q=${q}`);
        if (mode === 'feed_at' && limit === 7) assert.deepEqual(ids, await expectedOrder());
        if (mode === 'sort_at' && limit === 7) {
          const { rows } = await pool.query('SELECT job_id FROM job_feed ORDER BY sort_at DESC, job_id DESC');
          assert.deepEqual(ids, rows.map(r => Number(r.job_id)));
        }
      }
    }
  });
}

test('cursor minted under the other ordering is refused with 409, never applied', { skip }, async () => {
  await prodLikeDataset();
  process.env.FEED_ORDER = 'sort_at';
  await startApp();
  const p1 = await get('/jobs/feed?country=US&limit=10');
  assert.equal(decodeCursor(p1.body.nextCursor).mode, 'sort_at');
  process.env.FEED_ORDER = 'feed_at';
  const stale = await get(`/jobs/feed?country=US&limit=10&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.restart, true);
  const f1 = await get('/jobs/feed?country=US&limit=10');
  assert.equal(decodeCursor(f1.body.nextCursor).mode, 'feed_at');
  process.env.FEED_ORDER = 'sort_at'; // rollback
  assert.equal((await get(`/jobs/feed?country=US&limit=10&cursor=${encodeURIComponent(f1.body.nextCursor)}`)).status, 409);
  // A legacy two-element cursor (minted before this change) is a sort_at cursor.
  const legacy = Buffer.from(JSON.stringify(['2026-10-01T00:00:00.000Z', 5])).toString('base64url');
  assert.equal((await get(`/jobs/feed?country=US&cursor=${legacy}`)).status, 200);
  process.env.FEED_ORDER = 'feed_at';
  assert.equal((await get(`/jobs/feed?country=US&cursor=${legacy}`)).status, 409);
  assert.equal((await get('/jobs/feed?cursor=garbage')).status, 400);
});

test('cache key includes the order mode; flipping the flag does not serve stale-order pages', { skip }, async () => {
  const p = { country: 'US', limit: 25, cursor: null };
  assert.notEqual(feedCacheKey(p, 'sort_at'), feedCacheKey(p, 'feed_at'));
  await prodLikeDataset();
  await startApp(); // one router, one cache, both modes
  process.env.FEED_ORDER = 'sort_at';
  const a = await get('/jobs/feed?country=US&limit=25');
  process.env.FEED_ORDER = 'feed_at';
  const b = await get('/jobs/feed?country=US&limit=25');
  assert.notDeepEqual(a.body.jobs.map(j => j.id), b.body.jobs.map(j => j.id));
  assert.equal(decodeCursor(b.body.nextCursor).mode, 'feed_at');
});

test('before the backfill (feed_at NULL) feed_at mode orders exactly like sort_at', { skip }, async () => {
  await prodLikeDataset();
  await pool.query('UPDATE job_feed SET feed_at = NULL, company_rank = NULL');
  process.env.FEED_ORDER = 'feed_at';
  await startApp();
  const ids = (await walk('country=US', 8)).map(j => j.id);
  const { rows } = await pool.query('SELECT job_id FROM job_feed ORDER BY sort_at DESC, job_id DESC');
  assert.deepEqual(ids, rows.map(r => Number(r.job_id)));
});

test('mixed NULL and filled feed_at (rolling deploy) still paginates without duplicates or gaps', { skip }, async () => {
  await prodLikeDataset();
  await pool.query('UPDATE job_feed SET feed_at = NULL, company_rank = NULL WHERE job_id % 3 = 0');
  process.env.FEED_ORDER = 'feed_at';
  await startApp();
  const ids = (await walk('', 6)).map(j => j.id);
  assert.equal(new Set(ids).size, 50);
});

test('new rows are ranked after sync; older rows shift down', { skip }, async () => {
  const ids = await addJobs([0, 1, 2].map(i => ({ company: 'Acme', ageMs: (10 + i) * HOUR })));
  const rank = async () => Object.fromEntries((await pool.query('SELECT job_id, company_rank r, feed_at FROM job_feed')).rows.map(r => [r.job_id, r]));
  let r = await rank();
  assert.deepEqual(ids.map(id => r[id].r), [1, 2, 3]);
  assert.equal(r[ids[1]].feed_at.getTime(), (await pool.query('SELECT sort_at FROM job_feed WHERE job_id=$1', [ids[1]])).rows[0].sort_at.getTime() - STEP_MS);
  const [fresh] = await addJobs([{ company: 'Acme', ageMs: HOUR }]);
  r = await rank();
  assert.equal(r[fresh].r, 1);
  assert.deepEqual(ids.map(id => r[id].r), [2, 3, 4]);
  assert.equal(r[fresh].feed_at.getTime(), (await pool.query('SELECT sort_at FROM job_feed WHERE job_id=$1', [fresh])).rows[0].sort_at.getTime()); // rank 1: no penalty
});

test('a multi-location job counts once and every active row copies its rank', { skip }, async () => {
  const multi = [{ city: 'Austin', region: 'TX', country: 'US' }, { city: 'Dallas', region: 'TX', country: 'US' }, { city: 'Toronto', region: 'ON', country: 'CA' }];
  const [m, single] = await addJobs([{ company: 'Acme', ageMs: HOUR, locs: multi }, { company: 'Acme', ageMs: 2 * HOUR }]);
  const { rows } = await pool.query('SELECT job_id, company_rank, is_primary FROM job_feed ORDER BY job_id, city_key');
  assert.equal(rows.filter(r => r.job_id == m).length, 3);
  assert.ok(rows.filter(r => r.job_id == m).every(r => r.company_rank === 1));
  assert.equal(rows.find(r => r.job_id == single).company_rank, 2); // not 4: three rows of one job
});

test('deactivation reranks the rest and the inactive row leaves the ranking', { skip }, async () => {
  const ids = await addJobs([0, 1, 2].map(i => ({ company: 'Acme', ageMs: (1 + i) * HOUR })));
  await deactivateInFeed(pool, [ids[0]]);
  const { rows } = await pool.query('SELECT job_id, company_rank r, is_active FROM job_feed WHERE is_active ORDER BY job_id');
  assert.deepEqual(rows.map(r => [Number(r.job_id), r.r]), [[ids[1], 1], [ids[2], 2]]);
});

test('a job moving to another company reranks both companies', { skip }, async () => {
  const [a1, a2] = await addJobs([{ company: 'Acme', ageMs: HOUR }, { company: 'Acme', ageMs: 2 * HOUR }]);
  const globex = await company('Globex');
  await pool.query('UPDATE job SET company_id = $1 WHERE id = $2', [globex, a1]);
  await syncJobFeed(pool, a1);
  const { rows } = await pool.query('SELECT job_id, company_key, company_rank r FROM job_feed ORDER BY job_id');
  assert.deepEqual(rows.map(r => [Number(r.job_id), r.company_key, r.r]), [[a1, 'globex', 1], [a2, 'acme', 1]]);
});

test('a batch is one recompute pass; companyKeys defers it to the caller (reconcile)', { skip }, async () => {
  const companyKeys = new Set();
  const [id] = await addJobs([{ company: 'Acme', ageMs: HOUR }], { sync: false });
  await syncJobFeedBatch(pool, [id], { companyKeys });
  assert.deepEqual([...companyKeys], ['acme']);
  assert.equal((await pool.query('SELECT company_rank FROM job_feed')).rows[0].company_rank, null);
  await recomputeCompanyRank(pool, companyKeys);
  assert.equal((await pool.query('SELECT company_rank FROM job_feed')).rows[0].company_rank, 1);
});

test('a recompute failure never fails the sync', { skip }, async () => {
  const [id] = await addJobs([{ company: 'Acme', ageMs: HOUR }], { sync: false });
  const flaky = { query: (t, p) => (/recompute_company_rank/.test(t) ? Promise.reject(new Error('boom')) : pool.query(t, p)) };
  const warnings = [];
  assert.equal(await syncJobFeedBatch(flaky, [id], { logger: { warn: (...a) => warnings.push(a) } }), 1);
  assert.equal(warnings.length, 1);
});

test('a company with thousands of jobs is bounded: rank capped, one new job rewrites O(cap) rows', { skip }, async () => {
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
    SELECT g,'US','TX','austin', date_trunc('milliseconds', now() - g * interval '1 minute'),'t','Big','big','u',true,true,true FROM generate_series(1,3000) g`);
  await pool.query("SELECT recompute_company_rank(ARRAY['big'])");
  const { rows: [s] } = await pool.query('SELECT max(company_rank) mx, count(*) FILTER (WHERE company_rank = 121)::int capped, count(DISTINCT feed_at - sort_at)::int penalties FROM job_feed');
  assert.equal(s.mx, 121);
  assert.equal(s.capped, 2880);
  assert.equal(s.penalties, 121);
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
    VALUES (99999,'US','TX','austin', date_trunc('milliseconds', now()),'t','Big','big','u',true,true,true)`);
  const { rows: [w] } = await pool.query("SELECT recompute_company_rank(ARRAY['big']) n");
  assert.ok(w.n <= 125, `rewrote ${w.n} rows`);
});

test('recompute-all statement matches per-company recompute, is idempotent and fast', { skip }, async () => {
  const N = 30_000;
  await pool.query(`INSERT INTO job_feed (job_id,country_code,region_code,city_key,sort_at,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary,is_active)
    SELECT g,'US','TX','austin', date_trunc('milliseconds', now() - random() * 30 * interval '1 day'),'t','C','co'||(1+floor(power(random(),3)*500))::int,'u',true,true,true, random() > 0.1
    FROM generate_series(1,${N}) g`);
  const all = read('manual/20261011000200_recompute_company_rank_all.sql').replace(/^analyze.*$/m, '');
  const t0 = Date.now();
  const first = await pool.query(all);
  const ms = Date.now() - t0;
  assert.ok(first.rowCount > 20_000);
  assert.ok(ms < 15_000, `recompute-all took ${ms} ms for ${N} rows`);
  assert.equal((await pool.query(all)).rowCount, 0);
  const snap = async () => (await pool.query('SELECT job_id, company_rank, feed_at FROM job_feed WHERE is_active ORDER BY job_id')).rows;
  const viaAll = await snap();
  await pool.query('UPDATE job_feed SET company_rank = NULL, feed_at = NULL');
  await pool.query('SELECT recompute_company_rank(array_agg(DISTINCT company_key)) FROM job_feed');
  assert.deepEqual(await snap(), viaAll);
});

test('feedOrderMode defaults to sort_at; only the exact value feed_at flips it', () => {
  assert.equal(feedOrderMode({}), 'sort_at');
  assert.equal(feedOrderMode({ FEED_ORDER: 'feed_at' }), 'feed_at');
  assert.equal(feedOrderMode({ FEED_ORDER: 'FEED_AT' }), 'sort_at');
  assert.equal(decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 3, 'feed_at')).mode, 'feed_at');
});
