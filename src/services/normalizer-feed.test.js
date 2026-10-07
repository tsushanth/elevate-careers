// src/services/normalizer-feed.test.js
// Skipped unless TEST_DATABASE_URL is set. Never point at production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, normalizer;

before(async () => {
  if (skip) return;
  // IndexNow pings and Clearbit logo lookups use global fetch: keep the test offline.
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS normalizer_feed_test CASCADE');
  await admin.query('CREATE SCHEMA normalizer_feed_test');
  await admin.end();
  // Every connection the app's db pool opens lands in the scratch schema.
  const scratch = new URL(url);
  scratch.searchParams.set('options', '-c search_path=normalizer_feed_test');
  process.env.DATABASE_URL = scratch.toString();
  pool = new pg.Pool({ connectionString: scratch.toString(), max: 2 });
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT UNIQUE, logo_domain TEXT, name_normalized TEXT);
    CREATE TABLE discovered_company (id BIGSERIAL PRIMARY KEY, provider TEXT, org TEXT, name TEXT, last_ingested_at TIMESTAMPTZ);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT, external_id TEXT,
      apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN, salary_min NUMERIC, salary_max NUMERIC,
      salary_currency TEXT, posted_at TIMESTAMPTZ, valid_through TIMESTAMPTZ, description_excerpt TEXT, tsv TSVECTOR,
      current_version_id BIGINT, dedupe_key TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
      is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_version (id BIGSERIAL PRIMARY KEY, job_id BIGINT, description_md TEXT);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT, city TEXT, region TEXT, country TEXT, remote BOOLEAN);
  `);
  await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261008000000_job_feed.sql', import.meta.url), 'utf8').replaceAll('public.', ''));
  normalizer = (await import('./normalizer.js')).default;
});

after(async () => {
  if (!pool) return;
  await pool.query('DROP SCHEMA normalizer_feed_test CASCADE');
  await pool.end();
  // The app's own pool otherwise holds the process open for its 30s idle timeout.
  await (await import('../db/index.js')).db.close();
});

const raw = (id, over = {}) => ({
  provider: 'greenhouse', external_id: String(id), company_domain: 'acme.greenhouse.io',
  title: `Engineer ${id}`, apply_url: `https://boards.greenhouse.io/acme/jobs/${id}`, description: '<p>Build things</p>',
  location: 'Austin, TX', remote: false, posted_at: '2026-10-01T00:00:00Z', ...over,
});

test('ingesting a new job creates job_feed rows', { skip }, async () => {
  await normalizer.processJobs([raw(1), raw(2)], 'greenhouse', 'acme');
  const { rows } = await pool.query('SELECT * FROM job_feed ORDER BY job_id');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.country_code === 'US' && r.region_code === 'TX' && r.is_active));
});

test('a job missing from the next fetch is deactivated in the feed too', { skip }, async () => {
  await normalizer.processJobs([raw(1)], 'greenhouse', 'acme'); // job 2 is gone
  const { rows } = await pool.query('SELECT external_id, f.is_active FROM job j JOIN job_feed f ON f.job_id = j.id ORDER BY external_id');
  assert.deepEqual(rows.map(r => [r.external_id, r.is_active]), [['1', true], ['2', false]]);
});
