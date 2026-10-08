// Unit tests use a fake db. Integration tests are skipped unless TEST_DATABASE_URL is set
// (e.g. docker postgres:16 on port 54332). Never point at production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { reconcileFeed, startFeedReconcile } from './feedReconcile.js';

const quiet = () => { const logs = []; return { logs, warn: (...a) => logs.push(['warn', ...a]), info: (...a) => logs.push(['info', ...a]) }; };

test('unit: a failing db never throws and is counted', async () => {
  const logger = quiet();
  const db = { async query() { throw new Error('db down'); } };
  const stats = await reconcileFeed(db, { sleepMs: 0, logger });
  assert.equal(stats.errors, 2);
  assert.equal(stats.resynced, 0);
  assert.ok(logger.logs.some(l => l[0] === 'info'));
});

test('unit: stale jobs are resynced in batches and dead feed jobs deactivated', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('FROM (SELECT id, updated_at')) return { rows: [{ id: '30', stale: true }, { id: '20', stale: false }, { id: '10', stale: true }] };
      if (sql.includes('FROM job_feed') && sql.includes('LIMIT')) return { rows: [{ job_id: '9' }, { job_id: '9' }, { job_id: '8' }] };
      if (sql.includes('FROM job WHERE id = ANY')) return { rows: [{ id: '8' }] };                 // 9 is inactive/gone
      if (sql.startsWith('UPDATE job_feed')) { calls.push(`deactivate ${params[0]}`); return { rows: [] }; }
      if (sql.includes('FROM job j JOIN company')) { calls.push(`sync ${params[0]}`); return { rows: [] }; }
      return { rows: [] };
    },
  };
  const stats = await reconcileFeed(db, { sleepMs: 0, batch: 1 });
  assert.equal(stats.resynced, 2);
  assert.equal(stats.deactivated, 1);
  assert.equal(stats.errors, 0);
  assert.ok(calls.includes('sync 30') && calls.includes('sync 10'));
  assert.ok(!calls.includes('sync 20'));
  assert.ok(calls.includes('deactivate 9'));
});

test('unit: one failing resync batch does not stop the rest', async () => {
  let n = 0;
  const db = {
    async query(sql) {
      if (sql.includes('FROM (SELECT id, updated_at')) return { rows: [{ id: '2', stale: true }, { id: '1', stale: true }] };
      if (sql.includes('FROM job j JOIN company')) { if (n++ === 0) throw new Error('boom'); return { rows: [] }; }
      return { rows: [] };
    },
  };
  const stats = await reconcileFeed(db, { sleepMs: 0, batch: 1, logger: quiet() });
  assert.equal(stats.resyncFailed, 1);
  assert.equal(stats.resynced, 1);
});

test('unit: scheduler runs after the initial delay, stop() cancels', async () => {
  let runs = 0;
  const db = { async query() { runs++; return { rows: [] }; } };
  const s = startFeedReconcile({ db, logger: quiet(), initialDelayMs: 10, intervalMs: 3_600_000 });
  await new Promise(r => setTimeout(r, 80));
  s.stop();
  const after1 = runs;
  assert.ok(after1 > 0);
  const s2 = startFeedReconcile({ db, logger: quiet(), initialDelayMs: 10, intervalMs: 3_600_000 });
  s2.stop();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(runs, after1);
});

// ---- integration ----
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_reconcile_test CASCADE');
  await admin.query('CREATE SCHEMA feed_reconcile_test');
  await admin.end();
  const scratch = new URL(url);
  scratch.searchParams.set('options', '-c search_path=feed_reconcile_test');
  pool = new pg.Pool({ connectionString: scratch.toString(), max: 2 });
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC, salary_max NUMERIC,
      salary_currency TEXT, posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT, city TEXT, region TEXT, country TEXT, remote BOOLEAN);
  `);
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
});

after(async () => {
  if (!pool) return;
  await pool.query('DROP SCHEMA feed_reconcile_test CASCADE');
  await pool.end();
});

test('integration: reconcile repairs missing, changed-location and inactive jobs, and is idempotent', { skip }, async () => {
  await pool.query(`INSERT INTO company (name, name_normalized) VALUES ('Acme', 'acme')`);
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  for (let i = 1; i <= 4; i++) {
    await pool.query(`INSERT INTO job (company_id, provider, apply_url, title, posted_at, created_at, updated_at) VALUES (1,'greenhouse',$1,$2,$3,$3,$3)`,
      [`https://x/${i}`, `Job ${i}`, old]);
    await pool.query(`INSERT INTO job_location (job_id, city, region, country) VALUES ($1,'Austin','TX','US')`, [i]);
  }
  const { syncJobFeedBatch } = await import('./jobFeed.js');
  await syncJobFeedBatch(pool, [1, 2, 3]);                                   // job 4 never synced (failed hook)
  // job 2: location changed recently, feed is stale
  await pool.query(`UPDATE job_location SET city='Boston', region='MA' WHERE job_id=2`);
  await pool.query(`UPDATE job SET updated_at = now() WHERE id=2`);
  // job 3: deactivated outside the normaliser, long ago (not in the recent window)
  await pool.query(`UPDATE job SET is_active=false WHERE id=3`);

  const stats = await reconcileFeed(pool, { sleepMs: 0 });
  assert.equal(stats.errors, 0);

  const feed = (await pool.query('SELECT job_id::int AS id, region_code, is_active FROM job_feed ORDER BY job_id')).rows;
  const byId = Object.fromEntries(feed.map(r => [r.id, r]));
  assert.ok(byId[4] && byId[4].is_active, 'missing job 4 is now in the feed');
  assert.equal(byId[2].region_code, 'MA', 'changed location re-synced');
  assert.equal(byId[3].is_active, false, 'inactive job deactivated in feed');
  assert.equal(byId[1].is_active, true);

  const again = await reconcileFeed(pool, { sleepMs: 0 });
  assert.equal(again.errors, 0);
  const feed2 = (await pool.query('SELECT job_id::int AS id, region_code, is_active FROM job_feed ORDER BY job_id')).rows;
  assert.deepEqual(feed2, feed);
});
