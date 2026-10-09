// Near-home-first feed (nearHome.js + feedQuery.js buildNearQuery) against a real Postgres.
// Skipped unless TEST_DATABASE_URL is set (scratch schema, never production).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { rebuildGeoPlaces } from '../services/geoPlace.js';
import { feedCacheKey, parseFeedParams, encodeCursor } from '../services/feedQuery.js';
import { homeSig } from '../services/nearHome.js';

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';
let pool, server, base, exclusions = null, cache;
const saved = {};
const ENV = { FEED_NEAR: 'on', FEED_ORDER: 'feed_at', FEED_ROLE_MATCH: 'on' };

// IPs the stub "database" knows. 10.x is private (never looked up by the real module).
const GEO = {
  '1.0.0.1': { country: 'US', region: 'CA' },
  '2.0.0.1': { country: 'US', region: 'NY' },
  '3.0.0.1': { country: 'US', region: '' },     // US without a state -> tz
  '4.0.0.1': { country: 'GB', region: '' },     // another country
  '5.0.0.1': { country: 'US', region: 'OR' },   // a region with no jobs at all
};
const geoip = { lookup: (ip) => GEO[ip] ?? null };
const lookups = [];
const spyGeo = { lookup: (ip) => { lookups.push(ip); return geoip.lookup(ip); } };

const get = async (path, headers = {}) => {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const fromIp = (ip, extra = {}) => ({ 'fly-client-ip': ip, ...extra });

// Walks the whole list; returns { ids, pages, bodies }.
async function walk(path, headers, limit) {
  const ids = [], bodies = [];
  let cursor = null;
  for (let i = 0; i < 3000; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await get(`${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, headers);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    bodies.push(r.body);
    ids.push(...r.body.jobs.map(j => j.id));
    cursor = r.body.nextCursor;
    if (!cursor) return { ids, bodies };
  }
  throw new Error('pagination did not end');
}

// Oracle straight from the table: country scope, order (tier, key desc, id desc) with
//   tier 0 = region_code in the homes (any workplace type), tier 1 = remote with no state tag, tier 2 = the rest.
async function oracle(homes, { engineeringOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT job_id AS id, region_code, remote, title, coalesce(feed_at, sort_at) AS k FROM job_feed
      WHERE is_active AND is_country_primary AND country_code = 'US' ${engineeringOnly ? `AND title = 'Senior Software Engineer'` : ''}`);
  const tier = (r) => (!homes ? 0 : homes.includes(r.region_code) ? 0 : (r.remote && r.region_code === '' ? 1 : 2));
  if (!homes) return rows.sort((a, b) => (b.k - a.k) || (Number(b.id) - Number(a.id))).map(r => ({ id: Number(r.id), tier: 0, region: r.region_code, remote: r.remote }));
  rows.sort((a, b) => (tier(a) - tier(b)) || (b.k - a.k) || (Number(b.id) - Number(a.id)));
  return rows.map(r => ({ id: Number(r.id), tier: tier(r), region: r.region_code, remote: r.remote }));
}

before(async () => {
  if (skip) return;
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS feed_near_test CASCADE');
  await admin.query('CREATE SCHEMA feed_near_test');
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 3, options: '-c search_path=feed_near_test' });
  await pool.query('CREATE TABLE job (id BIGSERIAL PRIMARY KEY, tsv TSVECTOR)');
  for (const f of ['migrations/20261008000000_job_feed.sql', 'migrations/20261010000000_geo_place_absorb.sql', 'migrations/20261011000000_job_feed_company_rank.sql']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/${f}`, import.meta.url), 'utf8').replaceAll('public.', ''));
  }
  // the real indexes, so the planner paths under test are the production ones
  for (const f of ['20261011000300_job_feed_feedat_indexes', '20261012000100_job_feed_title_gin', '20261013000100_job_feed_country_remote_index']) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/manual/${f}.sql`, import.meta.url), 'utf8').replaceAll('public.', '').replace(/concurrently /g, ''));
  }

  // 480 US jobs. Regions: CA 30%, NY 20%, TX 10%, WA 10%, FL 10%, unknown ('') 20%; ~11% remote (every 9th job),
  // so remote jobs exist with a home-state tag, another state's tag and no tag.
  // Timestamps come in groups of 3 with the SAME key, so the (key, id) tie-break is exercised on every page size.
  const regions = ['CA', 'CA', 'CA', 'NY', 'NY', 'TX', 'WA', 'FL', '', ''];
  const t0 = Date.parse('2026-09-01T12:00:00.000Z');
  const add = async (id, cc, rc, over = {}) => {
    const key = new Date(t0 - Math.floor(id / 3) * 600_000 - (over.msShift || 0)).toISOString();
    await pool.query('INSERT INTO job (id, tsv) VALUES ($1, to_tsvector(\'english\', $2))', [id, over.title || 'Designer']);
    await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,feed_at,remote,title,company_name,company_key,apply_url,autofill_ready,is_primary,is_country_primary,is_region_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'Acme','acme','https://x/'||$1::bigint::text,true,true,$9,true)`,
      [id, cc, rc, 'c' + rc, rc ? 'City' : null, key, !!over.remote, over.title || 'Designer', over.countryPrimary ?? true]);
  };
  for (let i = 1; i <= 480; i++) {
    await add(i, 'US', regions[(i * 7) % 10], { remote: i % 9 === 0, title: i % 5 === 0 ? 'Senior Software Engineer' : 'Designer' });
  }
  // second-location rows of NY jobs, in CA: region-primary only, NOT country-primary (the job stays a tier-1 NY job)
  for (let i = 1; i <= 480; i += 17) {
    if (regions[(i * 7) % 10] === 'NY') await pool.query(
      `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,feed_at,remote,title,company_name,company_key,apply_url,is_primary,is_country_primary,is_region_primary)
       SELECT job_id,'US','CA','cx','Cx',sort_at,feed_at,remote,title,company_name,company_key,apply_url,false,false,true FROM job_feed WHERE job_id=$1 AND country_code='US' LIMIT 1`, [i]);
  }
  for (let i = 481; i <= 500; i++) await add(i, 'GB', '', { title: 'Designer' });
  await pool.query(`UPDATE job_feed SET is_active = false WHERE job_id IN (30, 31, 200)`);   // inactive rows are in no tier
  await pool.query('ANALYZE job_feed');
  await rebuildGeoPlaces(pool);

  cache = createFeedCache({ redis: null });
  const app = express();
  app.use('/v2', createFeedRouter({ db: pool, cache, getExclusions: async () => exclusions, geoip: spyGeo }));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/v2`;
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (server) await new Promise(r => server.close(r));
  if (pool) { await pool.query('DROP SCHEMA feed_near_test CASCADE'); await pool.end(); }
});

// Page that holds the last row of tier `from` and the first row of the next non-empty tier.
const crossingPage = (tiers, from, limit) => Math.floor(tiers.lastIndexOf(from) / limit);

for (const limit of [1, 7, 25, 50]) {
  test(`three tiers across pages (limit ${limit}): home state, nationwide remote, rest; no gaps, no duplicates, matches the oracle`, { skip }, async () => {
    const want = await oracle(['CA']);
    const { ids, bodies } = await walk('/jobs/feed?country=US', fromIp('1.0.0.1'), limit);
    assert.deepEqual(ids, want.map(w => w.id));
    assert.equal(new Set(ids).size, ids.length);
    // tier 0 strictly before tier 1 strictly before tier 2, all three non-empty
    const tiers = want.map(w => w.tier);
    for (const t of [0, 1, 2]) assert.ok(tiers.includes(t), `tier ${t} exists in the fixture`);
    assert.equal(tiers.indexOf(1), tiers.lastIndexOf(0) + 1);
    assert.equal(tiers.indexOf(2), tiers.lastIndexOf(1) + 1);
    for (const b of bodies) assert.deepEqual(b.near, { source: 'ip', regions: ['CA'], label: 'California' });
    if (limit === 7 || limit === 25) {
      // both crossings: 0 -> 1 and 1 -> 2 (the page ends are page-size dependent; check the pages that hold them)
      for (const from of [0, 1]) {
        const pageOf = crossingPage(tiers, from, limit);
        const crossing = bodies[pageOf].jobs.map(j => j.id);
        assert.deepEqual(crossing, want.slice(pageOf * limit, pageOf * limit + limit).map(w => w.id));
        const ts = new Set(crossing.map(id => want.find(w => w.id === id).tier));
        if (limit === 7) assert.ok(ts.has(from) && ts.has(from + 1), `page really crosses tier ${from} -> ${from + 1}`);
      }
    }
  });
}

test('remote jobs are placed by geography: home-state tag = tier 0, no tag = tier 1, another state = tier 2', { skip }, async () => {
  const want = await oracle(['CA']);
  const { ids } = await walk('/jobs/feed?country=US', fromIp('1.0.0.1'), 50);
  assert.deepEqual(ids, want.map(w => w.id));
  const byId = new Map(want.map(w => [w.id, w]));
  const rows = ids.map(id => byId.get(id));
  const t0 = rows.filter(r => r.tier === 0), t1 = rows.filter(r => r.tier === 1), t2 = rows.filter(r => r.tier === 2);
  assert.ok(t0.every(r => r.region === 'CA'));
  assert.ok(t0.some(r => r.remote), 'a remote job tagged to the home state is in tier 0');
  assert.ok(t0.some(r => !r.remote), 'on-site jobs of the home state are in tier 0');
  assert.ok(t1.length > 0 && t1.every(r => r.remote && r.region === ''), 'tier 1 is exactly the untagged remote jobs');
  assert.ok(t2.some(r => r.remote && r.region !== '' && r.region !== 'CA'), 'a remote job tagged to ANOTHER state is in tier 2');
  assert.ok(t2.some(r => r.region === '' && !r.remote), 'on-site jobs with an unknown state are in tier 2');
  assert.ok(t2.every(r => r.region !== 'CA' && !(r.remote && r.region === '')));
  // a nationwide remote job sorts ahead of a NEWER remote job tagged to another state
  const otherRemote = t2.find(r => r.remote && r.region !== '');
  const nationwide = t1[t1.length - 1];
  const all = await pool.query('SELECT job_id, coalesce(feed_at, sort_at) AS k FROM job_feed WHERE job_id = ANY($1) AND is_country_primary', [[otherRemote.id, nationwide.id]]);
  const key = Object.fromEntries(all.rows.map(r => [Number(r.job_id), r.k.getTime()]));
  if (key[otherRemote.id] > key[nationwide.id]) assert.ok(ids.indexOf(nationwide.id) < ids.indexOf(otherRemote.id));
  // a job whose country-primary row is in NY stays tier 2 even with a second CA location row
  assert.ok(t2.some(r => r.region === 'NY'));
});

test('a remote job tagged to another state, newer than every nationwide remote job, still sorts behind them', { skip }, async () => {
  await pool.query(`INSERT INTO job (id, tsv) VALUES (9001, to_tsvector('english','x')), (9002, to_tsvector('english','x'))`);
  const ins = (id, rc, key) => pool.query(
    `INSERT INTO job_feed (job_id,country_code,region_code,city_key,city,sort_at,feed_at,remote,title,company_name,company_key,apply_url,autofill_ready,is_primary,is_country_primary,is_region_primary)
     VALUES ($1::bigint,'US',$2::text,'c'||$2::text,'City',$3::timestamptz,$3::timestamptz,true,'Designer','Acme','acme','https://x/'||$1::bigint::text,true,true,true,true)`, [id, rc, key]);
  await ins(9001, 'NY', '2027-01-01T00:00:00.000Z');   // newest row in the table: remote, New York
  await ins(9002, '', '2026-01-01T00:00:00.000Z');      // very old, remote, no state
  try {
    const { ids } = await walk('/jobs/feed?country=US', fromIp('1.0.0.1'), 48);   // limit not used elsewhere: no stale cached pages
    assert.ok(ids.indexOf(9002) < ids.indexOf(9001), 'nationwide remote (old) before NY-tagged remote (newest)');
    const ny = await walk('/jobs/feed?country=US', fromIp('2.0.0.1'), 48);
    assert.equal(ny.ids[0], 9001, 'for a New Yorker the same job is tier 0 and first');
  } finally {
    await pool.query('DELETE FROM job_feed WHERE job_id IN (9001, 9002)');
    await pool.query('DELETE FROM job WHERE id IN (9001, 9002)');
  }
});

test('role=engineering: both tiers keep the filter and the order', { skip }, async () => {
  const want = await oracle(['NY'], { engineeringOnly: true });
  const { ids } = await walk('/jobs/feed?country=US&role=engineering', fromIp('2.0.0.1'), 7);
  assert.ok(want.length > 20);
  assert.deepEqual(ids, want.map(w => w.id));
});

test('a home with no jobs: tier 0 is empty, nationwide remote leads, nothing is lost', { skip }, async () => {
  const want = await oracle(['OR']);
  const { ids } = await walk('/jobs/feed?country=US', fromIp('5.0.0.1'), 25);
  assert.deepEqual(ids, want.map(w => w.id));
  assert.equal(want.filter(w => w.tier === 0).length, 0);
  assert.equal(want[0].tier, 1);
});

test('time zone fallback tiers the whole zone; label says so', { skip }, async () => {
  const r = await get('/jobs/feed?country=US&tz=America%2FLos_Angeles&limit=50', fromIp('3.0.0.1'));
  assert.deepEqual(r.body.near, { source: 'tz', regions: ['CA', 'NV', 'OR', 'WA'], label: 'Pacific time zone states' });
  const want = await oracle(['CA', 'NV', 'OR', 'WA']);
  const { ids } = await walk('/jobs/feed?country=US&tz=America%2FLos_Angeles', fromIp('3.0.0.1'), 25);
  assert.deepEqual(ids, want.map(w => w.id));
  // wide zone (more regions than the per-region probe limit) gives the same ordering
  const wide = await oracle(['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'OH', 'MI', 'IN', 'KY']);
  const w = await walk('/jobs/feed?country=US&tz=America%2FNew_York', fromIp('3.0.0.1'), 25);
  assert.deepEqual(w.ids, wide.map(x => x.id));
});

test('ladder over HTTP: profile > ip > tz > none', { skip }, async () => {
  const q = '/jobs/feed?country=US&tz=America%2FChicago&limit=5';
  exclusions = { dismissed: [], excludedCompanies: [], prefs: null, profile: null, location: 'Seattle, WA' };
  let r = await get(q, fromIp('1.0.0.1', { authorization: 'Bearer t' }));
  assert.deepEqual(r.body.near, { source: 'profile', regions: ['WA'], label: 'Washington' });
  exclusions = { dismissed: [], excludedCompanies: [], prefs: null, profile: null, location: 'Germany' };   // unusable: IP next
  r = await get(q, fromIp('1.0.0.1', { authorization: 'Bearer t' }));
  assert.equal(r.body.near.source, 'ip');
  assert.deepEqual(r.body.near.regions, ['CA']);
  exclusions = null;
  r = await get(q, fromIp('3.0.0.1'));                       // IP without a state: tz
  assert.equal(r.body.near.source, 'tz');
  assert.ok(r.body.near.regions.includes('TX'));
  r = await get('/jobs/feed?country=US&limit=5', fromIp('3.0.0.1'));   // nothing usable
  assert.equal('near' in r.body, false);
  r = await get('/jobs/feed?country=US&limit=5&tz=Europe%2FBerlin');
  assert.equal('near' in r.body, false);
  r = await get('/jobs/feed?country=US&limit=5&tz=not%20a%20zone', fromIp('3.0.0.1'));
  assert.equal('near' in r.body, false);
  r = await get('/jobs/feed?country=US&limit=5&tz=America%2FChicago', fromIp('4.0.0.1'));   // IP in the UK: no tiering
  assert.equal('near' in r.body, false);
  r = await get('/jobs/feed?country=US&limit=5', { 'fly-client-ip': '10.1.2.3' });          // private address
  assert.equal('near' in r.body, false);
  exclusions = null;
});

test('signed-in profile home bypasses the shared cache; ip/tz homes use it', { skip }, async () => {
  exclusions = { dismissed: [], excludedCompanies: [], prefs: null, profile: null, location: 'Austin, TX' };
  const auth = fromIp('1.0.0.1', { authorization: 'Bearer t' });
  let r = await get('/jobs/feed?country=US&limit=5', auth);
  assert.equal(r.headers.get('x-cache'), 'BYPASS');
  assert.equal(r.body.near.source, 'profile');
  r = await get('/jobs/feed?country=US&limit=5', auth);
  assert.equal(r.headers.get('x-cache'), 'BYPASS');
  exclusions = null;
  r = await get('/jobs/feed?country=US&limit=6&tz=America%2FChicago', fromIp('3.0.0.1'));
  assert.equal(r.headers.get('x-cache'), 'MISS');
  r = await get('/jobs/feed?country=US&limit=6&tz=America%2FChicago', fromIp('3.0.0.1'));
  assert.equal(r.headers.get('x-cache'), 'HIT-L1');
  assert.match(r.headers.get('cache-control'), /private/);
});

test('cache keys differ per home: pages for different homes never mix', { skip }, async () => {
  const a = await get('/jobs/feed?country=US&limit=10&tz=America%2FChicago', fromIp('3.0.0.1'));
  const ca = await get('/jobs/feed?country=US&limit=10', fromIp('1.0.0.1'));
  const ny = await get('/jobs/feed?country=US&limit=10', fromIp('2.0.0.1'));
  assert.equal(ca.headers.get('x-cache'), 'MISS');
  assert.equal(ny.headers.get('x-cache'), 'MISS');
  const ids = (x) => x.body.jobs.map(j => j.id).join();
  assert.notEqual(ids(ca), ids(ny));
  assert.notEqual(ids(ca), ids(a));
  assert.deepEqual(ca.body.near.regions, ['CA']);
  assert.deepEqual(ny.body.near.regions, ['NY']);
  // the same home again is served from the cache and is identical
  const ca2 = await get('/jobs/feed?country=US&limit=10', fromIp('1.0.0.1'));
  assert.equal(ca2.headers.get('x-cache'), 'HIT-L1');
  assert.equal(ids(ca2), ids(ca));
  // and a client without a home (the warmer's default key) is not served a tiered page
  const none = await get('/jobs/feed?country=US&limit=10');
  assert.equal('near' in none.body, false);
  const p = parseFeedParams({ country: 'US', limit: '10' }).params;
  assert.notEqual(feedCacheKey(p), feedCacheKey(p, undefined, { regions: ['CA'] }));
  // the key of the three-tier scheme differs from the old two-tier key (['near', regions]) for the same home
  const oldKey = JSON.stringify([{ ...p }, null, 'feed_at', ['near', 'CA']]);
  const newKey = feedCacheKey(p, 'feed_at', { regions: ['CA'] });
  assert.notEqual(newKey, oldKey);
  assert.ok(newKey.includes('"n3"') && !newKey.includes('"near"'));
});

test('cursors: only continue the same tiered list, otherwise 409 restart', { skip }, async () => {
  const first = await get('/jobs/feed?country=US&limit=5', fromIp('1.0.0.1'));
  const cur = first.body.nextCursor;
  const ok = await get(`/jobs/feed?country=US&limit=5&cursor=${cur}`, fromIp('1.0.0.1'));
  assert.equal(ok.status, 200);
  // another home
  let r = await get(`/jobs/feed?country=US&limit=5&cursor=${cur}`, fromIp('2.0.0.1'));
  assert.deepEqual([r.status, r.body], [409, { error: 'cursor expired', restart: true }]);
  // no home any more (IP not usable)
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${cur}`);
  assert.equal(r.status, 409);
  // near=off: the tiered cursor is stale
  r = await get(`/jobs/feed?country=US&limit=5&near=off&cursor=${cur}`, fromIp('1.0.0.1'));
  assert.equal(r.status, 409);
  // a legacy 3-element cursor while tiering is active
  const legacy = encodeCursor('2026-09-01T00:00:00.000Z', 100, 'feed_at');
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${legacy}`, fromIp('1.0.0.1'));
  assert.deepEqual([r.status, r.body], [409, { error: 'cursor expired', restart: true }]);
  // a cursor minted under the other ordering still 409s as before
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${encodeCursor('2026-09-01T00:00:00.000Z', 100, 'sort_at')}`, fromIp('1.0.0.1'));
  assert.equal(r.status, 409);
  // a cursor minted under the old two-tier scheme: same home, but an unversioned signature -> restart
  for (const old of [[0, 'CA'], [1, 'CA']]) {
    const oldCur = Buffer.from(JSON.stringify([old[0], '2026-09-01T00:00:00.000Z', 100, 'f', old[1]])).toString('base64url');
    r = await get(`/jobs/feed?country=US&limit=5&cursor=${oldCur}`, fromIp('1.0.0.1'));
    assert.deepEqual([r.status, r.body], [409, { error: 'cursor expired', restart: true }], `old tier ${old[0]} cursor`);
  }
  // a tier-2 cursor of the current scheme continues
  const t2cur = encodeCursor('2026-09-01T00:00:00.000Z', 100, 'feed_at', { tier: 2, sig: homeSig(['CA']) });
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${t2cur}`, fromIp('1.0.0.1'));
  assert.equal(r.status, 200);
  // a tiered cursor for a different mode (hand-made)
  const wrongSig = Buffer.from(JSON.stringify([0, '2026-09-01T00:00:00.000Z', 100, 'f', homeSig(['TX'])])).toString('base64url');
  r = await get(`/jobs/feed?country=US&limit=5&cursor=${wrongSig}`, fromIp('1.0.0.1'));
  assert.equal(r.status, 409);
});

test('near=off, state/city lists, worldwide, remote, keyword: exactly the current behaviour', { skip }, async () => {
  const plain = await oracle(null);
  const off = await walk('/jobs/feed?country=US&near=off', fromIp('1.0.0.1'), 25);
  assert.deepEqual(off.ids, plain.map(w => w.id));
  assert.equal(off.bodies.every(b => !('near' in b)), true);
  for (const path of ['/jobs/feed?country=US&region=CA&limit=5', '/jobs/feed?limit=5', '/jobs/feed?country=US&remote=true&limit=5', '/jobs/feed?country=US&city=city&region=CA&limit=5', '/jobs/feed?country=US&q=designer&limit=5']) {
    const r = await get(path, fromIp('1.0.0.1'));
    assert.equal(r.status, 200, path);
    assert.equal('near' in r.body, false, path);
  }
  // the count of the first page is the same with and without tiers
  const a = await get('/jobs/feed?country=US&limit=5', fromIp('1.0.0.1'));
  const b = await get('/jobs/feed?country=US&limit=5&near=off', fromIp('1.0.0.1'));
  assert.equal(a.body.count, b.body.count);
  assert.equal(a.body.countIsCapped, b.body.countIsCapped);
});

test('kill switch: FEED_NEAR off (or FEED_ORDER=sort_at) restores today exactly, params ignored, IP never looked up', { skip }, async () => {
  const before = lookups.length;
  for (const env of [{ FEED_NEAR: undefined }, { FEED_NEAR: 'off' }, { FEED_ORDER: undefined }]) {
    const keep = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try {
      const r = await get('/jobs/feed?country=US&limit=10&tz=America%2FLos_Angeles&near=on', fromIp('1.0.0.1'));
      assert.equal(r.status, 200);
      assert.equal('near' in r.body, false);
      assert.equal(r.headers.get('cache-control'), null);
      const keys = r.body.jobs.map(j => j.id);
      const cols = (await pool.query(`SELECT job_id FROM job_feed WHERE is_active AND is_country_primary AND country_code='US'
        ORDER BY ${env.FEED_ORDER === undefined ? 'sort_at' : 'coalesce(feed_at, sort_at)'} DESC, job_id DESC LIMIT 10`)).rows.map(x => Number(x.job_id));
      assert.deepEqual(keys, cols);
      assert.match(r.body.nextCursor ? Buffer.from(r.body.nextCursor, 'base64url').toString() : '[""', /^\[\"/);   // 3-element cursor, no tier
      // a tiered cursor is stale while the feature is off
      const tiered = encodeCursor('2026-09-01T00:00:00.000Z', 100, process.env.FEED_ORDER === 'feed_at' ? 'feed_at' : 'sort_at', { tier: 0, sig: homeSig(['CA']) });
      assert.equal((await get(`/jobs/feed?country=US&cursor=${tiered}`, fromIp('1.0.0.1'))).status, 409);
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }
  assert.equal(lookups.length, before, 'no IP was looked up while the feature was off');
});

test('stored data: nothing in the response or the cache key carries the client address', { skip }, async () => {
  const r = await get('/jobs/feed?country=US&limit=3', fromIp('1.0.0.1'));
  assert.equal(JSON.stringify(r.body).includes('1.0.0.1'), false);
  const p = parseFeedParams({ country: 'US', limit: '3' }).params;
  assert.equal(feedCacheKey(p, undefined, { regions: ['CA'] }).includes('1.0.0.1'), false);
});
