import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { createSavedJobsRouter, SAVED_JOB_SCHEMA_SQL } from './saved-jobs-core.js';

// Integration test against a real Postgres. Skipped unless TEST_DATABASE_URL is
// set, so `npm test` stays green on machines without a database. Never point
// this at production: it creates and drops its own tables in a scratch schema.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';

const ALICE = '00000000-0000-0000-0000-00000000000a';
const BOB = '00000000-0000-0000-0000-00000000000b';

let pool, server, base;

// Test auth: "Bearer <user-id>" authenticates as that user; anything else is 401.
const requireAuth = (req, res, next) => {
  const id = req.headers.authorization?.replace('Bearer ', '');
  if (id !== ALICE && id !== BOB) return res.status(401).json({ error: 'Not signed in' });
  req.user = { id };
  next();
};

const call = (method, path, user) =>
  fetch(base + path, { method, headers: user ? { authorization: `Bearer ${user}` } : {} });

before(async () => {
  if (skip) return;
  // Create the scratch schema on a throwaway client, then pin every pooled
  // connection to it (search_path is per-connection).
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS saved_jobs_test CASCADE');
  await admin.query('CREATE SCHEMA saved_jobs_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', c => c.query('SET search_path TO saved_jobs_test'));
  await pool.query(`
    CREATE TABLE company (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, domain TEXT, logo_domain TEXT);
    CREATE TABLE job (id BIGSERIAL PRIMARY KEY, company_id BIGINT REFERENCES company(id), provider TEXT NOT NULL DEFAULT 'greenhouse',
                      external_id TEXT, apply_url TEXT NOT NULL, title TEXT NOT NULL, employment_type TEXT, remote BOOLEAN,
                      salary_min NUMERIC, salary_max NUMERIC, salary_currency TEXT, posted_at TIMESTAMPTZ, valid_through TIMESTAMPTZ,
                      description_excerpt TEXT, tsv TSVECTOR, is_active BOOLEAN DEFAULT true);
    CREATE TABLE job_location (id BIGSERIAL PRIMARY KEY, job_id BIGINT REFERENCES job(id), city TEXT, country TEXT);
    INSERT INTO company (name, domain) VALUES ('Acme', 'acme.com');
    INSERT INTO job (company_id, title, apply_url) VALUES (1, 'Staff Engineer', 'https://x/1'), (1, 'Designer', 'https://x/2');
    INSERT INTO job_location (job_id, city, country) VALUES (1, 'Austin', 'US'), (1, 'Remote', 'US');
  `);
  for (const sql of SAVED_JOB_SCHEMA_SQL) await pool.query(sql);

  const app = express();
  app.use('/api/saved-jobs', createSavedJobsRouter({ db: pool, requireAuth }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/saved-jobs`;
});

after(async () => {
  if (skip) return;
  await new Promise(r => server.close(r));
  await pool.query('DROP SCHEMA IF EXISTS saved_jobs_test CASCADE');
  await pool.end();
});

test('rejects unauthenticated requests', { skip }, async () => {
  for (const [m, p] of [['GET', ''], ['PUT', '/1'], ['DELETE', '/1']]) {
    assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
  }
});

test('save is idempotent and list returns /jobs-shaped rows newest first', { skip }, async () => {
  assert.equal((await call('PUT', '/1', ALICE)).status, 200);
  assert.equal((await call('PUT', '/1', ALICE)).status, 200); // second save is not an error
  assert.equal((await call('PUT', '/2', ALICE)).status, 200);

  const rows = (await (await call('GET', '', ALICE)).json()).jobs;
  assert.deepEqual(rows.map(r => Number(r.id)), [2, 1]); // newest first, no duplicate for job 1
  const job1 = rows[1];
  assert.equal(job1.company_name, 'Acme');
  assert.deepEqual(job1.cities.sort(), ['Austin', 'Remote']);
  assert.ok(job1.saved_at);
  assert.equal(job1.tsv, undefined); // internal columns are not leaked
  assert.equal((await (await call('GET', '', ALICE)).json()).count, 2);
});

test('shortlists are private per user', { skip }, async () => {
  assert.deepEqual((await (await call('GET', '', BOB)).json()).jobs, []);
  await call('PUT', '/1', BOB);
  await call('DELETE', '/1', BOB); // Bob removing job 1 must not touch Alice's copy
  const alice = (await (await call('GET', '', ALICE)).json()).jobs;
  assert.ok(alice.some(r => Number(r.id) === 1));
});

test('remove is idempotent', { skip }, async () => {
  assert.equal((await call('DELETE', '/2', ALICE)).status, 200);
  assert.equal((await call('DELETE', '/2', ALICE)).status, 200);
  assert.deepEqual((await (await call('GET', '', ALICE)).json()).jobs.map(r => Number(r.id)), [1]);
});

test('validates ids and unknown jobs', { skip }, async () => {
  assert.equal((await call('PUT', '/abc', ALICE)).status, 400);
  assert.equal((await call('PUT', '/-3', ALICE)).status, 400);
  assert.equal((await call('PUT', '/0', ALICE)).status, 400);
  assert.equal((await call('PUT', '/999999', ALICE)).status, 404);
});

test('a deactivated job stays on the shortlist and reports is_active=false', { skip }, async () => {
  await pool.query('UPDATE job SET is_active = false WHERE id = 1');
  const rows = (await (await call('GET', '', ALICE)).json()).jobs;
  assert.equal(rows.find(r => Number(r.id) === 1).is_active, false);
});
