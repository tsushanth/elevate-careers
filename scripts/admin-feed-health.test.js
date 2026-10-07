import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

// DB-backed test for simplyapply_admin_feed_health().
// SAFETY: it drops/creates the database admin_feed_health_test and creates the
// cluster-wide roles anon/authenticated if missing, so it only runs against a
// local server (127.0.0.1, localhost, ::1); any other TEST_DATABASE_URL skips
// the DB tests. The roles persist in the throwaway container (harmless).
const DB = 'admin_feed_health_test';

export function isLocalTestUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  host = host.replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

const RAW_URL = process.env.TEST_DATABASE_URL;
const URL_ = isLocalTestUrl(RAW_URL) ? RAW_URL : undefined;
const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const PLAIN = '00000000-0000-0000-0000-0000000000b2';
const NOGOOGLE = '00000000-0000-0000-0000-0000000000c3';
const UNCONF = '00000000-0000-0000-0000-0000000000d4';

let pool;

function withDb(url) {
  const u = new URL(url);
  u.pathname = `/${DB}`;
  return u.toString();
}

// Runs the function as the given user (null = no claim) inside a transaction.
async function callAs(sub) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (sub) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    const r = await c.query('select public.simplyapply_admin_feed_health() as h');
    return r.rows[0].h;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}

before(async () => {
  if (!URL_) return;
  const admin = new pg.Pool({ connectionString: URL_, max: 1 });
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: withDb(URL_), max: 2 });
  await pool.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.job (id bigserial primary key, is_active boolean not null default true);
    create table public.simplyapply_admins (email text primary key);
  `);
  await pool.query(read('supabase/migrations/20261008000000_job_feed.sql'));
  await pool.query(read('supabase/migrations/20261009000000_admin_feed_health.sql'));

  await pool.query(`
    insert into auth.users values
      ('${ADMIN}', 'Admin@Example.com', now(), '{"providers":["google"]}'),
      ('${PLAIN}', 'plain@example.com', now(), '{"providers":["google"]}'),
      ('${NOGOOGLE}', 'nogoogle@example.com', now(), '{"providers":["email"]}'),
      ('${UNCONF}', 'unconf@example.com', null, '{"providers":["google"]}');
    insert into public.simplyapply_admins values ('admin@example.com'), ('nogoogle@example.com'), ('unconf@example.com');
    -- jobs 1,2,3 active; 4 inactive
    insert into public.job (is_active) values (true), (true), (true), (false);
    insert into public.job_feed (job_id, country_code, sort_at, title, company_name, apply_url, is_active) values
      (1, 'US', now(), 't', 'c', 'u', true),
      (2, 'ZZ', now(), 't', 'c', 'u', true),
      (4, 'US', now(), 't', 'c', 'u', true);
    insert into public.geo_place (type, label, name_key, country_code) values
      ('country', 'United States', 'united states', 'US'),
      ('country', 'United Kingdom', 'united kingdom', 'GB');
  `);
});

after(async () => {
  if (!URL_) return;
  if (pool) await pool.end();
  const admin = new pg.Pool({ connectionString: URL_, max: 1 });
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

const skip = URL_ ? false
  : (RAW_URL ? 'TEST_DATABASE_URL is not a local server (127.0.0.1, localhost, ::1); refusing to run' : 'TEST_DATABASE_URL not set');

test('isLocalTestUrl only allows local servers', () => {
  assert.equal(isLocalTestUrl('postgresql://postgres:test@127.0.0.1:54329/postgres'), true);
  assert.equal(isLocalTestUrl('postgresql://postgres:test@localhost:5432/postgres'), true);
  assert.equal(isLocalTestUrl('postgresql://postgres:test@[::1]:5432/postgres'), true);
  assert.equal(isLocalTestUrl('postgresql://postgres:pw@db.example.supabase.co:5432/postgres'), false);
  assert.equal(isLocalTestUrl('postgresql://postgres:pw@127.0.0.1.evil.com/postgres'), false);
  assert.equal(isLocalTestUrl(undefined), false);
  assert.equal(isLocalTestUrl(''), false);
  assert.equal(isLocalTestUrl('not a url'), false);
});

// Must run before anything analyzes job_feed: reltuples is -1 on PG14+ here.
test('feed_rows is never negative on a never-analyzed table', { skip }, async () => {
  const { rows } = await pool.query(`select reltuples from pg_class where oid = 'public.job_feed'::regclass`);
  assert.ok(Number(rows[0].reltuples) <= 0, 'fixture precondition: not analyzed yet');
  const h = await callAs(ADMIN);
  assert.ok(h.feed_rows >= 0, `feed_rows was ${h.feed_rows}`);
});

test('an admin gets the reconciliation counts', { skip }, async () => {
  await pool.query('analyze public.job_feed');
  const h = await callAs(ADMIN);
  assert.deepEqual(Object.keys(h).sort(),
    ['active_jobs_missing_from_feed', 'feed_rows', 'inactive_job_active_in_feed', 'places', 'unknown_location_jobs']);
  assert.equal(typeof h.feed_rows, 'number');
  assert.ok(h.feed_rows >= 0);
  assert.equal(h.active_jobs_missing_from_feed, 1);
  assert.equal(h.unknown_location_jobs, 1);
  assert.equal(h.inactive_job_active_in_feed, 1);
  assert.equal(h.places, 2);
});

for (const [name, sub] of [
  ['a signed-in non-admin', PLAIN],
  ['an admin without a google provider', NOGOOGLE],
  ['an admin with an unconfirmed email', UNCONF],
  ['no auth.uid()', null],
]) {
  test(`${name} gets P0002`, { skip }, async () => {
    await assert.rejects(() => callAs(sub), (e) => e.code === 'P0002');
  });
}
