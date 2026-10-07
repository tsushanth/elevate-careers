import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const URL_ = process.env.TEST_DATABASE_URL;
const DB = 'admin_feed_health_test';
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
    analyze public.job_feed;
  `);
});

after(async () => {
  if (!URL_) return;
  if (pool) await pool.end();
  const admin = new pg.Pool({ connectionString: URL_, max: 1 });
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
});

const skip = URL_ ? false : 'TEST_DATABASE_URL not set';

test('an admin gets the reconciliation counts', { skip }, async () => {
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
