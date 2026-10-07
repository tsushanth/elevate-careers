// src/services/jobFeed.test.js
// Integration test against a real Postgres. Skipped unless TEST_DATABASE_URL
// is set. Never point this at production: it drops and recreates a scratch schema.
// Local database: docker run -d --name pg-feed-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16
//   TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/postgres
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { syncJobFeed, syncJobFeedBatch, deactivateInFeed } from './jobFeed.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS job_feed_test CASCADE');
  await admin.query('CREATE SCHEMA job_feed_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', c => c.query('SET search_path TO job_feed_test'));
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC,
      salary_max NUMERIC, salary_currency TEXT, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT REFERENCES job(id), city TEXT, region TEXT, country TEXT, remote BOOLEAN);
    INSERT INTO company (name, domain, logo_domain, name_normalized) VALUES ('Acme', 'acme.com', 'acme.com', 'acme');
  `);
  // The real migration, so the test cannot drift from production.
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8')
    .replaceAll('public.', ''));
});

after(async () => { if (pool) { await pool.query('DROP SCHEMA job_feed_test CASCADE'); await pool.end(); } });

const addJob = async (title, locs, over = {}) => {
  const { rows: [j] } = await pool.query(
    `INSERT INTO job (company_id, provider, apply_url, title, posted_at, is_active)
     VALUES (1, 'greenhouse', 'https://boards.greenhouse.io/acme/jobs/' || $1, $1, $2, $3) RETURNING id`,
    [title, over.posted_at ?? '2026-10-01T00:00:00Z', over.is_active ?? true]);
  for (const l of locs) {
    await pool.query('INSERT INTO job_location (job_id, city, region, country) VALUES ($1,$2,$3,$4)', [j.id, l.city, l.region, l.country]);
  }
  return j.id;
};
const feed = (id) => pool.query('SELECT * FROM job_feed WHERE job_id = $1 ORDER BY city_key', [id]).then(r => r.rows);

test('sync writes rows with flags and company fields', { skip }, async () => {
  const id = await addJob('A1', [{ city: 'Austin', region: 'TX', country: 'TX' }, { city: 'Dallas', region: 'TX', country: 'TX' }]);
  assert.equal(await syncJobFeed(pool, id), 2);
  const rows = await feed(id);
  assert.deepEqual(rows.map(r => r.city_key), ['austin', 'dallas']);
  assert.equal(rows.filter(r => r.is_country_primary).length, 1);
  assert.equal(rows[0].company_name, 'Acme');
  assert.equal(rows[0].company_key, 'acme');
  assert.equal(rows[0].autofill_ready, true);
});

test('re-sync after locations change removes stale rows and is idempotent', { skip }, async () => {
  const id = await addJob('A2', [{ city: 'Austin', region: 'TX', country: 'TX' }, { city: 'Toronto', region: 'ON', country: 'CA' }]);
  await syncJobFeed(pool, id);
  assert.equal((await feed(id)).length, 2);
  await pool.query('DELETE FROM job_location WHERE job_id = $1 AND city = $2', [id, 'Toronto']);
  await syncJobFeed(pool, id);
  await syncJobFeed(pool, id);
  assert.deepEqual((await feed(id)).map(r => r.city_key), ['austin']);
});

test('a job with no location rows becomes one ZZ row', { skip }, async () => {
  const id = await addJob('A3', []);
  await syncJobFeed(pool, id);
  const rows = await feed(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country_code, 'ZZ');
});

test('deactivateInFeed hides rows; a deleted job loses its rows on sync', { skip }, async () => {
  const id = await addJob('A4', [{ city: 'Austin', region: 'TX', country: 'TX' }]);
  await syncJobFeed(pool, id);
  await deactivateInFeed(pool, [id]);
  assert.equal((await feed(id))[0].is_active, false);
  await pool.query('DELETE FROM job_location WHERE job_id = $1', [id]);
  await pool.query('DELETE FROM job WHERE id = $1', [id]);
  await syncJobFeed(pool, id);
  assert.equal((await feed(id)).length, 0);
});

test('batch sync handles many jobs in one call', { skip }, async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await addJob(`B${i}`, [{ city: 'Austin', region: 'TX', country: 'TX' }]));
  assert.equal(await syncJobFeedBatch(pool, ids), 5);
});
