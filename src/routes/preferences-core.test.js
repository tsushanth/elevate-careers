import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { parsePreferences, buildPreferencesUpsert, createSavePreferencesHandler } from './preferences-core.js';

// ---- pure parsing / SQL building (always runs) ----

test('parsePreferences keeps only the fields the client sent', () => {
  const { values, error } = parsePreferences({ keywords: ['react'], remote: true, bogus: 1 });
  assert.equal(error, undefined);
  assert.deepEqual(values, { keywords: ['react'], remote: true });
});

test('parsePreferences passes explicit clears through (empty list, false, null)', () => {
  const { values } = parsePreferences({ excluded_companies: [], remote: false, location: '', salary_min: null });
  assert.deepEqual(values, { excluded_companies: [], remote: false, location: null, salary_min: null });
});

test('parsePreferences coerces numeric strings and keeps the old "0 or empty means none" for salary', () => {
  assert.deepEqual(parsePreferences({ salary_min: '120000', daily_limit: '5' }).values, { salary_min: 120000, daily_limit: 5 });
  assert.deepEqual(parsePreferences({ salary_min: 0 }).values, { salary_min: null });
  assert.deepEqual(parsePreferences({ salary_min: 120000.9 }).values, { salary_min: 120000 });
});

test('parsePreferences rejects wrong types instead of letting them reach the database', () => {
  for (const body of [
    { keywords: 'react' }, { keywords: [1] }, { excluded_titles: {} }, { remote: 'yes' }, { enabled: 1 },
    { require_visa_sponsor: 'true' }, { location: 5 }, { salary_min: 'lots' }, { salary_min: -1 },
    { daily_limit: 1.5 }, { daily_limit: 'x' }, { daily_limit: -2 }, null, [], 'str',
  ]) {
    assert.ok(parsePreferences(body).error, `should reject ${JSON.stringify(body)}`);
  }
});

test('buildPreferencesUpsert updates only the sent columns on conflict, and uses old defaults for a new row', () => {
  const { sql, params } = buildPreferencesUpsert('u1', { keywords: ['a'], remote: true });
  const conflict = sql.slice(sql.indexOf('DO UPDATE SET'));
  assert.match(conflict, /keywords=EXCLUDED\.keywords/);
  assert.match(conflict, /remote=EXCLUDED\.remote/);
  assert.match(conflict, /updated_at=NOW\(\)/);
  for (const untouched of ['excluded_companies', 'excluded_titles', 'excluded_locations', 'require_visa_sponsor', 'enabled', 'salary_min', 'daily_limit', 'location', 'auto_apply_similar']) {
    assert.doesNotMatch(conflict, new RegExp(`${untouched}=`), `${untouched} must not be overwritten`);
  }
  assert.equal(params[0], 'u1');
  const idx = (col) => 1 + ['keywords', 'remote', 'location', 'salary_min', 'excluded_companies', 'excluded_titles', 'excluded_locations', 'daily_limit', 'enabled', 'auto_apply_similar', 'require_visa_sponsor'].indexOf(col);
  assert.deepEqual(params[idx('keywords')], ['a']);
  assert.equal(params[idx('remote')], true);
  assert.equal(params[idx('daily_limit')], 10);
  assert.equal(params[idx('enabled')], false);
  assert.deepEqual(params[idx('excluded_companies')], []);
  assert.equal((sql.match(/\$\d+/g) || []).length, params.length);
});

// ---- handler over HTTP with a recording fake db (always runs) ----

async function withServer(db, fn) {
  const app = express();
  app.use(express.json());
  app.post('/p', (req, _res, next) => { req.user = { id: 'u1' }; next(); }, createSavePreferencesHandler({ db }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/p`); }
  finally { await new Promise(r => server.close(r)); }
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('handler: valid partial body runs one upsert and answers ok', async () => {
  const calls = [];
  await withServer({ query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } }, async (url) => {
    const r = await post(url, { keywords: ['x'] });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 'u1');
});

test('handler: invalid body is a 400 and never reaches the database', async () => {
  let n = 0;
  await withServer({ query: async () => { n++; return {}; } }, async (url) => {
    const r = await post(url, { remote: 'yes' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /remote/);
  });
  assert.equal(n, 0);
});

test('handler: a database failure is a 500 with a generic message', async () => {
  const orig = console.error; console.error = () => {};
  try {
    await withServer({ query: async () => { throw new Error('boom secret detail'); } }, async (url) => {
      const r = await post(url, { keywords: [] });
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: 'Failed to save preferences' });
    });
  } finally { console.error = orig; }
});

// ---- real Postgres (skipped unless TEST_DATABASE_URL is set; uses its own scratch schema) ----

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool;

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS prefs_test CASCADE');
  await admin.query('CREATE SCHEMA prefs_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('connect', c => c.query('SET search_path TO prefs_test'));
  await pool.query(`CREATE TABLE apply_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE,
    keywords TEXT[] NOT NULL DEFAULT '{}', remote BOOLEAN NOT NULL DEFAULT false, location TEXT, salary_min INTEGER,
    excluded_companies TEXT[] NOT NULL DEFAULT '{}', excluded_titles TEXT[] NOT NULL DEFAULT '{}', excluded_locations TEXT[] NOT NULL DEFAULT '{}',
    daily_limit INTEGER NOT NULL DEFAULT 10, enabled BOOLEAN NOT NULL DEFAULT false, auto_apply_similar BOOLEAN NOT NULL DEFAULT false,
    require_visa_sponsor BOOLEAN DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
});
after(async () => {
  if (skip) return;
  await pool.query('DROP SCHEMA IF EXISTS prefs_test CASCADE');
  await pool.end();
});

const U = '00000000-0000-0000-0000-00000000000a';
async function withPgServer(fn) {
  const app = express();
  app.use(express.json());
  app.post('/p', (req, _res, next) => { req.user = { id: U }; next(); }, createSavePreferencesHandler({ db: pool }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/p`); }
  finally { await new Promise(r => server.close(r)); }
}
const row = async () => (await pool.query('SELECT * FROM apply_preferences WHERE user_id=$1', [U])).rows[0];

test('postgres: a web-style partial save does not wipe exclusions, visa flag or enabled', { skip }, async () => {
  await pool.query('DELETE FROM apply_preferences');
  await withPgServer(async (u) => {
    // The phone app saves everything.
    let r = await post(u, { keywords: ['backend'], remote: false, location: 'Austin', salary_min: 90000,
      excluded_companies: ['Acme'], excluded_titles: ['Intern'], excluded_locations: ['Texas'],
      require_visa_sponsor: true, daily_limit: 7, enabled: true, auto_apply_similar: false });
    assert.equal(r.status, 200);
    // The web app later saves only what its form edits.
    r = await post(u, { keywords: ['frontend'], remote: true, location: '', salary_min: null, daily_limit: 12 });
    assert.equal(r.status, 200);
  });
  const x = await row();
  assert.deepEqual(x.keywords, ['frontend']);
  assert.equal(x.remote, true);
  assert.equal(x.location, null);
  assert.equal(x.salary_min, null);
  assert.equal(x.daily_limit, 12);
  assert.deepEqual(x.excluded_companies, ['Acme']);
  assert.deepEqual(x.excluded_titles, ['Intern']);
  assert.deepEqual(x.excluded_locations, ['Texas']);
  assert.equal(x.require_visa_sponsor, true);
  assert.equal(x.enabled, true);
});

test('postgres: explicit empties still clear a field, and a first save uses the old defaults', { skip }, async () => {
  await pool.query('DELETE FROM apply_preferences');
  await withPgServer(async (u) => {
    await post(u, { keywords: ['a'] });
    let x = await row();
    assert.equal(x.daily_limit, 10);
    assert.equal(x.enabled, false);
    assert.equal(x.require_visa_sponsor, false);
    assert.deepEqual(x.excluded_companies, []);
    await post(u, { excluded_companies: ['Acme'], require_visa_sponsor: true });
    await post(u, { excluded_companies: [], require_visa_sponsor: false });
    x = await row();
    assert.deepEqual(x.excluded_companies, []);
    assert.equal(x.require_visa_sponsor, false);
    assert.deepEqual(x.keywords, ['a']);
  });
});
