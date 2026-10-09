// Profile fit ranking (FEED_FIT_RANK) on the near-home feed, against a scratch schema (skipped unless TEST_DATABASE_URL is set).
// The oracle is computed in JS from a per-title table (class of each title), independent of the SQL tsqueries.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { normalizePrefs } from '../services/feedPrefs.js';
import { decodeCursor } from '../services/feedQuery.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, exclusions = null, cache;
const saved = {};
const ENV = { FEED_NEAR: 'on', FEED_ORDER: 'feed_at', FEED_ROLE_MATCH: 'on', FEED_FIT_RANK: 'on' };
const geoip = { lookup: (ip) => (ip === '1.0.0.1' ? { country: 'US', region: 'CA' } : null) };
const HOME = { 'fly-client-ip': '1.0.0.1', authorization: 'Bearer x' };

// title -> { m: in the profile match (keywords Software Engineer / Full-Stack, family engineering), s: literal match,
//            level: level mismatch, mgmt: management mismatch }
const T = {
  'Senior Software Engineer':           { m: 1, s: 1 },
  'Staff Software Engineer, Backend':   { m: 1, s: 1 },
  'Full Stack Engineer':                { m: 1, s: 1 },
  'Software Engineer Intern':           { m: 1, s: 1, level: 1 },
  'Software Engineer, New Grad':        { m: 1, s: 1, level: 1 },
  'Software Engineering Manager':       { m: 1, s: 1, mgmt: 1 },
  'Product Engineer':                   { m: 1, s: 0 },
  'Forward Deployed Data Engineer':     { m: 1, s: 0 },
  'Director of Engineering':            { m: 1, s: 0, mgmt: 1 },
  'Backend Developer':                  { m: 1, s: 0 },
  'Designer':                           { m: 0, s: 0 },
};
const NAMES = Object.keys(T);
const REGIONS = ['CA', 'CA', 'CA', 'NY', 'NY', 'TX', '', ''];

// Oracle: the profile-matched, non-excluded rows ordered by (tier, bucket, key desc, id desc) for a CA home.
async function oracle({ level = true, ic = true, fit = true, strongOnly = null } = {}) {
  const { rows } = await pool.query(`SELECT job_id AS id, title, region_code, remote, coalesce(feed_at, sort_at) AS k FROM job_feed WHERE is_active AND is_country_primary AND country_code = 'US'`);
  const tier = (r) => (r.region_code === 'CA' ? 0 : (r.remote && r.region_code === '' ? 1 : 2));
  const bucket = (r) => { const t = T[r.title]; return !fit ? 0 : (t.s && (!strongOnly || strongOnly.includes(r.title)) && !(level && t.level) && !(ic && t.mgmt)) ? 0 : 1; };
  return rows.filter(r => T[r.title].m).sort((a, b) =>
    (tier(a) - tier(b)) || (bucket(a) - bucket(b)) || (b.k - a.k) || (Number(b.id) - Number(a.id)))
    .map(r => ({ id: Number(r.id), title: r.title, tier: tier(r), bucket: bucket(r) }));
}

const get = async (path, headers = HOME) => { const r = await fetch(base + path, { headers }); return { status: r.status, body: await r.json(), headers: r.headers }; };
async function walk(path, limit, headers = HOME) {
  const out = [], bodies = []; let cursor = null;
  for (let i = 0; i < 3000; i++) {
    const r = await get(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, headers);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    bodies.push(r.body); out.push(...r.body.jobs.map(j => j.id)); cursor = r.body.nextCursor;
    if (!cursor) return { ids: out, bodies };
  }
  throw new Error('pagination did not end');
}
const profile = (keywords, preferredTitles) => ({ userId: 'u', dismissed: [], excludedCompanies: [], prefs: null, location: null, profile: { keywords, preferredTitles } });
const SENIOR = () => profile(['Software Engineer', 'Full-Stack'], ['Senior Software Engineer']);

before(async () => {
  if (skip) return;
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_fit_test CASCADE');
  await admin.query('CREATE SCHEMA feed_fit_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_fit_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  for (const f of ['migrations/20261008000000_job_feed.sql', 'migrations/20261010000000_geo_place_absorb.sql', 'migrations/20261011000000_job_feed_company_rank.sql']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/${f}`, import.meta.url), 'utf8').replaceAll('public.', ''));
  }
  for (const f of ['20261011000300_job_feed_feedat_indexes', '20261012000100_job_feed_title_gin', '20261013000100_job_feed_country_remote_index']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/manual/${f}.sql`, import.meta.url), 'utf8').replaceAll('public.', '').replace(/concurrently /g, ''));
  }
  // 660 US jobs, titles cycle through the table, regions CA 37% / NY 25% / TX 12% / unknown 25%, every 9th remote.
  // Keys come in groups of 3 with the same timestamp (tie-break on id on every page size).
  const t0 = Date.parse('2026-09-01T12:00:00.000Z');
  for (let i = 1; i <= 660; i++) {
    const title = NAMES[(i * 5) % NAMES.length], rc = REGIONS[(i * 7) % REGIONS.length];
    const key = new Date(t0 - Math.floor(i / 3) * 600_000).toISOString();
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [i, title]);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,feed_at,remote,title,company_name,company_key,apply_url,autofill_ready,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,'US',$2,$3,$4,$5,$5,$6,$7,'Acme','acme','https://x/'||$1::bigint::text,true,true,true,true)`,
      [i, rc, 'c' + rc, rc ? 'City' : null, key, i % 9 === 0, title]);
  }
  await pool.query('ANALYZE job_feed');
  cache = createFeedCache({ redis: null });
  const app = express();
  app.use('/v2', createFeedRouter({ db: pool, cache, getExclusions: async () => exclusions, geoip }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (server) await new Promise(r => server.close(r));
  if (pool) { await pool.query('DROP SCHEMA feed_fit_test CASCADE'); await pool.end(); }
});
beforeEach(() => { process.env.FEED_FIT_RANK = 'on'; exclusions = SENIOR(); });

for (const limit of [1, 7, 25, 50]) {
  test(`order is (tier, bucket, recency) across pages (limit ${limit}); no gaps, no duplicates, matches the oracle`, { skip }, async () => {
    const want = await oracle();
    const { ids, bodies } = await walk('/jobs/feed?country=US', limit);
    assert.deepEqual(ids, want.map(w => w.id));
    assert.equal(new Set(ids).size, ids.length);
    // every (tier, bucket) cell is non-empty, so every bucket 0->1 and tier crossing is exercised
    for (const t of [0, 1, 2]) for (const b of [0, 1]) assert.ok(want.some(w => w.tier === t && w.bucket === b), `cell ${t}/${b} exists`);
    // a bucket-1 cursor is minted with bucket and a fit signature
    const cursors = bodies.map(b => b.nextCursor).filter(Boolean).map(decodeCursor);
    assert.ok(cursors.every(c => c.sig.startsWith('n3f:') && (c.bucket === 0 || c.bucket === 1)));
    if (limit === 7) assert.ok(cursors.some(c => c.bucket === 1) && cursors.some(c => c.bucket === 0));
  });
}

test('level and management mismatches land in bucket 1; family-only matches too; strong IC titles lead each tier', { skip }, async () => {
  const want = await oracle();
  const { ids } = await walk('/jobs/feed?country=US', 50);
  const byId = new Map(want.map(w => [w.id, w]));
  const rows = ids.map(id => byId.get(id));
  for (const t of [0, 1, 2]) {
    const tier = rows.filter(r => r.tier === t);
    const lastStrong = tier.map(r => r.bucket).lastIndexOf(0), firstBroad = tier.map(r => r.bucket).indexOf(1);
    assert.ok(lastStrong < firstBroad, `tier ${t}: all strong rows before all broader rows`);
    for (const r of tier.filter(x => x.bucket === 0)) assert.ok(['Senior Software Engineer', 'Staff Software Engineer, Backend', 'Full Stack Engineer'].includes(r.title), r.title);
    for (const r of tier) if (['Software Engineer Intern', 'Software Engineer, New Grad', 'Software Engineering Manager', 'Director of Engineering', 'Product Engineer'].includes(r.title)) assert.equal(r.bucket, 1, r.title);
  }
});

test('response: match.fit lists the active rules; count is the whole matched set; profile responses bypass the cache', { skip }, async () => {
  const want = await oracle();
  const r = await get('/jobs/feed?country=US&limit=7');
  assert.deepEqual(r.body.match.fit, ['Senior-level roles', 'Individual contributor roles']);
  assert.equal(r.body.match.source, 'profile');
  assert.equal(r.body.count, want.length);
  assert.equal(r.headers.get('x-cache'), 'BYPASS');
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
});

test('no seniority signal: no level demotion (interns and new grads stay strong), management still demoted', { skip }, async () => {
  exclusions = profile(['Software Engineer', 'Full-Stack'], []);
  const want = await oracle({ level: false });
  const { ids } = await walk('/jobs/feed?country=US', 25);
  assert.deepEqual(ids, want.map(w => w.id));
  assert.ok(want.some(w => w.title === 'Software Engineer Intern' && w.bucket === 0));
  const r = await get('/jobs/feed?country=US');
  assert.deepEqual(r.body.match.fit, ['Individual contributor roles']);
});

test('a management title in the profile switches the management rule off; with no rule active match.fit is absent', { skip }, async () => {
  exclusions = profile(['Software Engineer', 'Full-Stack'], ['Engineering Manager']);
  const want = await oracle({ level: false, ic: false });
  const { ids } = await walk('/jobs/feed?country=US', 25);
  assert.deepEqual(ids, want.map(w => w.id));
  assert.ok(want.some(w => w.title === 'Software Engineering Manager' && w.bucket === 0));
  const r = await get('/jobs/feed?country=US');
  assert.equal(r.body.match.fit, undefined);
  assert.equal(r.body.match.source, 'profile');
});

test('kill switch off: current behaviour (tier, recency), 5-element cursors, no match.fit', { skip }, async () => {
  process.env.FEED_FIT_RANK = 'off';
  const want = await oracle({ fit: false });
  const { ids, bodies } = await walk('/jobs/feed?country=US', 7);
  assert.deepEqual(ids, want.map(w => w.id));
  assert.equal(bodies[0].match.fit, undefined);
  for (const b of bodies.filter(x => x.nextCursor)) {
    const c = decodeCursor(b.nextCursor);
    assert.equal(c.bucket, undefined);
    assert.ok(c.sig.startsWith('n3:'));
    assert.equal(JSON.parse(Buffer.from(b.nextCursor, 'base64url').toString()).length, 5);
  }
});

test('cursors of the other scheme are refused with 409 restart, in both directions', { skip }, async () => {
  const on = (await get('/jobs/feed?country=US&limit=5')).body.nextCursor;
  process.env.FEED_FIT_RANK = 'off';
  const off = (await get('/jobs/feed?country=US&limit=5')).body.nextCursor;
  // fit cursor against the unbucketed list
  let r = await get(`/jobs/feed?country=US&limit=5&cursor=${encodeURIComponent(on)}`);
  assert.equal(r.status, 409); assert.deepEqual(r.body, { error: 'cursor expired', restart: true });
  process.env.FEED_FIT_RANK = 'on';
  // old (unbucketed, n3) cursor against the bucketed list
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${encodeURIComponent(off)}`);
  assert.equal(r.status, 409);
  // an old two-tier / plain 3-element cursor too
  const plain = Buffer.from(JSON.stringify(['2026-09-01T00:00:00.000Z', 5, 'f'])).toString('base64url');
  assert.equal((await get(`/jobs/feed?country=US&limit=5&cursor=${plain}`)).status, 409);
  // a bucket-less cursor that claims the fit signature is refused as well
  const fake = Buffer.from(JSON.stringify([0, '2026-09-01T00:00:00.000Z', 5, 'f', 'n3f:CA'])).toString('base64url');
  assert.equal((await get(`/jobs/feed?country=US&limit=5&cursor=${fake}`)).status, 409);
  // the right one still works
  assert.equal((await get(`/jobs/feed?country=US&limit=5&cursor=${encodeURIComponent(on)}`)).status, 200);
});

test('no bucketing for an explicit role, prefs=off, anonymous users or without a home', { skip }, async () => {
  const plain = await oracle({ fit: false });
  // prefs=off: the profile is not applied at all -> the whole country list in (tier, recency) order
  let r = await get('/jobs/feed?country=US&prefs=off&limit=50');
  assert.equal(r.body.match, undefined);
  assert.ok(r.body.jobs.some(j => j.title === 'Designer'));
  assert.equal(decodeCursor(r.body.nextCursor).bucket, undefined);
  // role=engineering: tier + recency only
  r = await get('/jobs/feed?country=US&role=engineering&limit=50');
  assert.equal(r.status, 200);
  assert.equal(r.body.match.source, 'role'); assert.equal(r.body.match.fit, undefined);
  assert.equal(decodeCursor(r.body.nextCursor).bucket, undefined);
  // anonymous (no authorization header): no profile, no bucket
  r = await get('/jobs/feed?country=US&limit=50', { 'fly-client-ip': '1.0.0.1' });
  assert.equal(r.body.match, undefined);
  assert.equal(decodeCursor(r.body.nextCursor).bucket, undefined);
  // no home resolvable (foreign IP, no tz): the plain list, no bucket
  exclusions = SENIOR();
  r = await get('/jobs/feed?country=US&limit=5', { authorization: 'Bearer x' });
  assert.equal(r.body.near, undefined);
  assert.equal(decodeCursor(r.body.nextCursor).bucket, undefined);
  assert.equal(r.body.match.fit, undefined);
  assert.ok(plain.length > 0);
});

test('hard exclusions still apply inside the buckets', { skip }, async () => {
  exclusions = { ...SENIOR(), prefs: normalizePrefs({ excluded_titles: ['Product Engineer'] }) };
  const want = (await oracle()).filter(w => w.title !== 'Product Engineer');
  const { ids } = await walk('/jobs/feed?country=US', 25);
  assert.deepEqual(ids, want.map(w => w.id));
});

test('a profile without any family (literal only): bucket 1 is pruned, the list is the literal match in (tier, recency) order', { skip }, async () => {
  exclusions = profile(['Designer'], []);
  const { rows } = await pool.query(`SELECT job_id AS id, region_code, remote, coalesce(feed_at, sort_at) AS k FROM job_feed WHERE title = 'Designer' AND is_active AND is_country_primary AND country_code = 'US'`);
  const tier = (r) => (r.region_code === 'CA' ? 0 : (r.remote && r.region_code === '' ? 1 : 2));
  const want = rows.sort((a, b) => (tier(a) - tier(b)) || (b.k - a.k) || (Number(b.id) - Number(a.id))).map(r => Number(r.id));
  const { ids, bodies } = await walk('/jobs/feed?country=US', 7);
  assert.deepEqual(ids, want);
  assert.ok(want.length > 20);
  assert.deepEqual(bodies[0].match.fit, ['Individual contributor roles']);
});

test('behaviour phrases: preferred titles that repeat are strong phrases next to the keywords', { skip }, async () => {
  // keywords name only Full-Stack; "software engineer" repeats in the preferred titles (cleaned: Senior / Staff stripped)
  exclusions = profile(['Full-Stack'], ['Senior Software Engineer', 'Staff Software Engineer (Java)']);
  let want = await oracle();
  let { ids } = await walk('/jobs/feed?country=US', 25);
  assert.deepEqual(ids, want.map(w => w.id));
  assert.ok(want.some(w => w.title === 'Senior Software Engineer' && w.bucket === 0));
  // without that behaviour the same keywords make "Senior Software Engineer" a broader fit
  exclusions = profile(['Full-Stack'], []);
  want = await oracle({ strongOnly: ['Full Stack Engineer'] });
  ({ ids } = await walk('/jobs/feed?country=US', 25));
  assert.deepEqual(ids, want.map(w => w.id));
  assert.ok(want.some(w => w.title === 'Senior Software Engineer' && w.bucket === 1));
});
