// Role filter and profile match on the v2 feed, against a scratch schema (skipped unless TEST_DATABASE_URL is set).
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { normalizePrefs } from '../services/feedPrefs.js';
import { _clearFamilyMemo } from '../services/roleMatch.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, cache, exclusions = null, throwExclusions = false, failFamilies = false, warnings = [];
const savedEnv = {};

const get = async (path, { auth = false } = {}) => {
  const r = await fetch(base + path, { headers: auth ? { authorization: 'Bearer x' } : {} });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const ids = (r) => r.body.jobs.map(j => j.id).sort((a, b) => a - b);
const titles = (r) => r.body.jobs.map(j => j.title);
// A signed-in user with an optional profile {keywords, preferredTitles} and optional apply_preferences row.
const user = (profile, prefsRow = null, extra = {}) => ({ userId: 'u', dismissed: [], excludedCompanies: [], prefs: normalizePrefs(prefsRow), profile, ...extra });
const ENG_PROFILE = { keywords: ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'], preferredTitles: [] };

// id -> title; ids 1..37 are engineering, then a spread of other families. All US; sort_at falls with the id.
const ENG = Array.from({ length: 37 }, (_, i) => [i + 1, i % 3 === 0 ? `Senior Software Engineer ${i}` : i % 3 === 1 ? `Full-Stack Developer ${i}` : `Backend Engineer, Team ${i}`]);
const OTHER = [
  [101, 'Sales Engineer'], [102, 'Mechanical Engineer'], [103, 'Account Executive'], [104, 'Registered Nurse (RN)'], [105, 'Paralegal'],
  [106, 'Senior Counsel'], [107, 'Product Manager'], [108, 'Reinforcement Learning Researcher'], [109, 'Software Engineer, Sales Platform'],
  [110, 'Technical Recruiter'], [111, 'Solutions Engineer'], [112, 'Business Developer'], [113, 'Cashier'], [114, 'Real Estate Developer'],
];

before(async () => {
  if (skip) return;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_role_test CASCADE');
  await admin.query('CREATE SCHEMA feed_role_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_role_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  for (const m of ['20261008000000_job_feed.sql', '20261010000000_geo_place_absorb.sql', '20261011000000_job_feed_company_rank.sql']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), 'utf8').replaceAll('public.', ''));
  }
  const rows = [...ENG, ...OTHER];
  for (const [id, title] of rows) {
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, title]);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,'US','TX','austin','Austin', now() - ($1::bigint::int * interval '1 minute'), false, $2,'Acme','acme','https://x',true,true,true)`, [id, title]);
  }
  await pool.query('ANALYZE job_feed');
  // one non-US job so place filters are meaningful
  await pool.query('INSERT INTO job (id, tsv) VALUES (200, to_tsvector(\'english\', \'Software Engineer\'))');
  await pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
     VALUES (200,'GB','','london','London', now() - interval '1 minute', false,'Software Engineer','Acme','acme','https://x',true,true,true)`);

  cache = createFeedCache({ redis: null });
  // The families lookup goes through this wrapper so a test can make it fail.
  const db = { query: (text, params) => (failFamilies && /JOIN unnest\(\$2::text\[\], \$3::text\[\]\)/.test(text) ? Promise.reject(new Error('families down')) : pool.query(text, params)) };
  const app = express();
  app.use('/v2', createFeedRouter({
    db, cache,
    getExclusions: async () => { if (throwExclusions) throw new Error('boom'); return exclusions; },
    logger: { warn: (...a) => warnings.push(a), error() {} },
  }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => { if (server) server.close(); if (pool) { await pool.query('DROP SCHEMA feed_role_test CASCADE'); await pool.end(); } });
beforeEach(() => {
  for (const k of ['FEED_ROLE_MATCH', 'FEED_ORDER']) savedEnv[k] = process.env[k];
  process.env.FEED_ROLE_MATCH = 'on';
  delete process.env.FEED_ORDER;
  exclusions = null; throwExclusions = false; failFamilies = false; warnings = [];
  _clearFamilyMemo();
});
afterEach(() => { for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

test('GET /roles: the 14 families in order when on, an empty list when off', { skip }, async () => {
  let r = await get('/roles');
  assert.equal(r.status, 200);
  assert.equal(r.body.roles.length, 14);
  assert.deepEqual(r.body.roles[0], { slug: 'engineering', label: 'Software engineering' });
  assert.deepEqual(r.body.roles.map(x => x.slug).slice(-2), ['legal', 'frontline']);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=3600');
  process.env.FEED_ROLE_MATCH = 'off';
  r = await get('/roles');
  assert.deepEqual(r.body, { roles: [] });
  assert.match(r.headers.get('cache-control'), /^public, max-age=\d+$/);
  delete process.env.FEED_ROLE_MATCH;
  assert.deepEqual((await get('/roles')).body, { roles: [] });
});

test('kill switch off: ?role= is a 400 "role filter disabled" and the profile match is skipped', { skip }, async () => {
  process.env.FEED_ROLE_MATCH = 'off';
  let r = await get('/jobs/feed?role=engineering');
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'role filter disabled' });
  exclusions = user(ENG_PROFILE);
  r = await get('/jobs/feed', { auth: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.match, undefined);
  assert.equal(r.body.prefs, undefined);
  assert.equal(r.body.jobs.length, 25);
  assert.ok(titles(r).some(t => /Nurse|Cashier|Account/.test(t)) || r.body.count > 25, 'unfiltered feed');
  assert.notEqual(r.headers.get('x-cache'), 'BYPASS');
});

test('400s: unknown role slug', { skip }, async () => {
  for (const bad of ['nope', 'ENGINEERING ', 'eng', '__proto__', 'engineering,legal']) {
    const r = await get('/jobs/feed?role=' + encodeURIComponent(bad));
    if (bad === 'ENGINEERING ') { assert.equal(r.status, 200, 'slugs are case/space tolerant'); continue; }
    assert.equal(r.status, 400, bad);
    assert.deepEqual(r.body, { error: 'invalid role' });
  }
});

test('role filter: only the family, the negatives are excluded, match describes it', { skip }, async () => {
  const r = await get('/jobs/feed?role=engineering&limit=50');
  const t = titles(r);
  assert.equal(r.body.jobs.length, 39);          // 37 here + the GB job + "Software Engineer, Sales Platform" (a software job that mentions sales)
  assert.ok(t.every(x => /Software Engineer|Full-Stack Developer|Backend Engineer/.test(x)), t.join('|'));
  assert.ok(t.includes('Software Engineer, Sales Platform'));
  for (const bad of ['Sales Engineer', 'Mechanical Engineer', 'Solutions Engineer', 'Business Developer', 'Real Estate Developer', 'Technical Recruiter'])
    assert.ok(!t.includes(bad), bad);
  assert.deepEqual(r.body.match, { source: 'role', roleSlug: 'engineering', roleLabel: 'Software engineering', labels: ['Software engineering'] });
  assert.equal(r.body.prefs, undefined);
  assert.equal(r.body.count, 39);
  assert.equal(r.body.countIsCapped, false);

  const legal = await get('/jobs/feed?role=legal');
  assert.deepEqual(titles(legal).sort(), ['Paralegal', 'Senior Counsel']);
  assert.deepEqual(legal.body.match.labels, ['Legal']);
  assert.equal(legal.body.count, 2);                       // sparse family: gated count, still exact

  const us = await get('/jobs/feed?role=engineering&country=US&limit=50');
  assert.equal(us.body.jobs.length, 38);                   // place filters compose with the role
  assert.equal((await get('/jobs/feed?role=product&country=GB')).body.jobs.length, 0);
});

test('role responses are cacheable and the cache key includes the role', { skip }, async () => {
  const a = await get('/jobs/feed?role=engineering&limit=5');
  assert.equal(a.headers.get('x-cache'), 'MISS');
  const a2 = await get('/jobs/feed?role=engineering&limit=5');
  assert.match(a2.headers.get('x-cache'), /^HIT/);
  const b = await get('/jobs/feed?role=legal&limit=5');
  assert.equal(b.headers.get('x-cache'), 'MISS');          // not served from the engineering entry
  assert.deepEqual(titles(b).sort(), ['Paralegal', 'Senior Counsel']);
  const none = await get('/jobs/feed?limit=5');
  assert.equal(none.headers.get('x-cache'), 'MISS');
  assert.ok(none.body.match === undefined);
  assert.deepEqual(a2.body.match.roleSlug, 'engineering');  // `match` rides along on a cache hit too
});

test('cursor pagination through a role: every page, no duplicates, no gaps (sort_at and feed_at)', { skip }, async () => {
  for (const order of [undefined, 'feed_at']) {
    if (order) process.env.FEED_ORDER = order; else delete process.env.FEED_ORDER;
    const seen = [];
    let path = '/jobs/feed?role=engineering&country=US&limit=10', pages = 0, first;
    for (;;) {
      const r = await get(path);
      assert.equal(r.status, 200);
      if (!first) first = r;
      seen.push(...r.body.jobs.map(j => j.id));
      pages++;
      if (r !== first) assert.equal(r.body.count, null, 'count is only computed on the first page');
      if (!r.body.nextCursor) break;
      path = `/jobs/feed?role=engineering&country=US&limit=10&cursor=${encodeURIComponent(r.body.nextCursor)}`;
    }
    assert.equal(pages, 4, String(order));
    assert.equal(first.body.count, 38);
    assert.deepEqual(seen, [...ENG.map(([id]) => id), 109], `${order || 'sort_at'} order`);   // 109 = "Software Engineer, Sales Platform"; newest first = lowest id first
    assert.equal(new Set(seen).size, seen.length);
  }
});

test('profile: applied by default as a soft preference, bypasses the shared and L1 caches', { skip }, async () => {
  exclusions = user(ENG_PROFILE);
  const l1 = cache._l1Size();
  for (let i = 0; i < 2; i++) {
    const r = await get('/jobs/feed?limit=50&country=US', { auth: true });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-cache'), 'BYPASS');
    const t = titles(r);
    assert.ok(t.includes('Reinforcement Learning Researcher'), 'literal phrase (no family)');
    assert.ok(t.includes('Senior Software Engineer 0') && t.includes('Full-Stack Developer 1') && t.includes('Backend Engineer, Team 2'), 'family via "Software Engineer" / "Full-Stack"');
    for (const bad of ['Sales Engineer', 'Mechanical Engineer', 'Account Executive', 'Registered Nurse (RN)', 'Paralegal', 'Cashier', 'Product Manager', 'Solutions Engineer'])
      assert.ok(!t.includes(bad), bad);
    assert.equal(r.body.jobs.length, 39);     // 37 engineering + "Software Engineer, Sales Platform" + "Reinforcement Learning Researcher"
    assert.equal(r.body.count, 39);
    assert.equal(r.body.prefs, 'applied');
    assert.deepEqual(r.body.match, { source: 'profile', roleSlug: null, roleLabel: null, labels: ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'] });
  }
  assert.equal(cache._l1Size(), l1);
});

test('profile from preferred_titles when there are no keywords; tech keywords are not a title filter', { skip }, async () => {
  exclusions = user({ keywords: [], preferredTitles: ['Senior Paralegal', 'Paralegal (Litigation)', 'Counsel, Commercial'] });
  const r = await get('/jobs/feed?country=US', { auth: true });
  assert.deepEqual(titles(r).sort(), ['Paralegal', 'Senior Counsel']);
  assert.deepEqual(r.body.match.labels, ['Paralegal', 'Counsel']);
  assert.equal(r.body.prefs, 'applied');
});

test('profile page and count agree, even when the profile family is sparse (gated count)', { skip }, async () => {
  exclusions = user({ keywords: ['Paralegal'] });
  const r = await get('/jobs/feed?country=US', { auth: true });
  assert.deepEqual(titles(r).sort(), ['Paralegal', 'Senior Counsel']);   // the phrase plus the legal family it falls in
  assert.equal(r.body.count, 2);
});

test('no profile: no match, no prefs marker, shared cache path', { skip }, async () => {
  for (const profile of [null, { keywords: [], preferredTitles: [] }, { keywords: [], preferredTitles: ['Engineer', ''] }]) {
    exclusions = user(profile);
    const r = await get('/jobs/feed?country=US&limit=5', { auth: true });
    assert.equal(r.body.match, undefined);
    assert.equal(r.body.prefs, undefined);
    assert.notEqual(r.headers.get('x-cache'), 'BYPASS');
  }
});

test('prefs=off disables the profile match but not an explicit role', { skip }, async () => {
  exclusions = user(ENG_PROFILE);
  let r = await get('/jobs/feed?country=US&prefs=off&limit=50', { auth: true });
  assert.equal(r.body.jobs.length, 50);
  assert.equal(r.body.prefs, 'off');
  assert.equal(r.body.match, undefined);
  assert.ok(r.body.nextCursor, 'unfiltered list: more than one page');
  assert.equal(r.body.count, 51);
  r = await get('/jobs/feed?role=legal&prefs=off', { auth: true });
  assert.deepEqual(titles(r).sort(), ['Paralegal', 'Senior Counsel']);
  assert.equal(r.body.match.source, 'role');
});

test('an explicit role wins over the profile; search and pills turn the profile off', { skip }, async () => {
  exclusions = user(ENG_PROFILE);
  let r = await get('/jobs/feed?role=legal', { auth: true });
  assert.deepEqual(titles(r).sort(), ['Paralegal', 'Senior Counsel']);
  assert.equal(r.body.match.source, 'role');
  assert.equal(r.body.prefs, undefined);                 // the profile was not applied, so nothing to report
  for (const path of ['/jobs/feed?q=nurse', '/jobs/feed?remote=true', '/jobs/feed?days=30', '/jobs/feed?type=full_time']) {
    r = await get(path, { auth: true });
    assert.equal(r.body.match, undefined, path);
    assert.equal(r.body.prefs, undefined, path);
  }
  r = await get('/jobs/feed?q=nurse', { auth: true });
  assert.deepEqual(titles(r), ['Registered Nurse (RN)']);
});

test('a signed-in explicit role without exclusions still uses the shared cache; with exclusions it bypasses', { skip }, async () => {
  exclusions = user(null);
  const a = await get('/jobs/feed?role=sales&limit=5', { auth: true });
  assert.notEqual(a.headers.get('x-cache'), 'BYPASS');
  exclusions = user(null, null, { dismissed: [103] });
  const b = await get('/jobs/feed?role=sales&limit=5', { auth: true });
  assert.equal(b.headers.get('x-cache'), 'BYPASS');
  assert.ok(!ids(b).includes(103));
});

test('role + soft preferences compose', { skip }, async () => {
  exclusions = user(ENG_PROFILE, { remote: true });
  const r = await get('/jobs/feed?role=engineering', { auth: true });
  assert.equal(r.body.jobs.length, 0);                   // nothing is remote
  assert.equal(r.body.prefs, 'applied');
  assert.equal(r.body.match.source, 'role');
});

test('count is capped past 1000 for a role, exact below', { skip }, async () => {
  await pool.query(`INSERT INTO job (id) SELECT g FROM generate_series(1000, 2200) g`);
  await pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,remote,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
     SELECT g,'FR','','paris','Paris', now(), false, 'Litigation Paralegal', 'Acme','acme','https://x',true,true,true FROM generate_series(1000, 2200) g`);
  await pool.query('ANALYZE job_feed');
  const r = await get('/jobs/feed?role=legal&country=FR');
  assert.equal(r.body.count, 1000);
  assert.equal(r.body.countIsCapped, true);
  const small = await get('/jobs/feed?role=legal&country=US');
  assert.equal(small.body.count, 2);
  assert.equal(small.body.countIsCapped, false);
  await pool.query(`DELETE FROM job_feed WHERE country_code = 'FR'`);
});

test('fail open: profile trouble serves the feed without it and says so', { skip }, async () => {
  exclusions = user(null, null, { profileUnavailable: true });
  let r = await get('/jobs/feed?country=GB', { auth: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-prefs'), 'unavailable');
  assert.equal(r.body.match, undefined);
  assert.deepEqual(titles(r), ['Software Engineer']);

  // the families lookup failing degrades to the literal phrases (still a match, still a 200, warned)
  failFamilies = true;
  exclusions = user({ keywords: ['Software Engineer'] });
  r = await get('/jobs/feed?country=US&limit=50', { auth: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.match.source, 'profile');
  assert.ok(titles(r).includes('Senior Software Engineer 0'));
  assert.ok(!titles(r).includes('Backend Engineer, Team 2'), 'only the literal phrase matched');
  assert.ok(warnings.some(w => /families unavailable/.test(w[1])));

  failFamilies = false; throwExclusions = true;
  r = await get('/jobs/feed?country=GB&role=engineering', { auth: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-exclusions'), 'unavailable');
  assert.equal(r.body.match.source, 'role');             // the role still applies to the anonymous fallback
});
