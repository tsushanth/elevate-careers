import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildJobsQuery, clampPage, createLimiter, jobsCacheKey, startJobsWarmer, MAX_LIMIT } from './jobsList.js';
import { createFeedCache } from './feedCache.js';

const NON_US = { regionCodesSql: 'ca|on', titleRegexSql: 'london' };
const norm = (s) => s.replace(/\s+/g, ' ');

test('clampPage defaults, clamps and ignores junk', () => {
  assert.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 });
  assert.deepEqual(clampPage('20', '40'), { limit: 20, offset: 40 });
  assert.deepEqual(clampPage('100000', '-5'), { limit: MAX_LIMIT, offset: 0 });
  assert.deepEqual(clampPage('abc', 'x'), { limit: 50, offset: 0 });
  assert.deepEqual(clampPage('0', '0'), { limit: 1, offset: 0 });
});

test('unfiltered query pages ids first: no GROUP BY, no company join inside the page, limit inside the subquery', () => {
  const q = buildJobsQuery({ filters: { limit: '20' } });
  const t = norm(q.text);
  assert.ok(!/GROUP BY/i.test(t), 'must not aggregate every active job');
  assert.deepEqual(q.params, [20, 0]);
  const inner = t.slice(t.indexOf('FROM ( SELECT'), t.indexOf(') page'));
  assert.ok(inner.includes('ORDER BY j.posted_at DESC NULLS LAST, j.id DESC LIMIT $1 OFFSET $2'));
  assert.ok(!inner.includes('JOIN company'), 'company join stays outside so the posted_at index can drive the scan');
  assert.ok(t.includes('LEFT JOIN LATERAL'));
  assert.ok(t.trim().endsWith('ORDER BY page.posted_at DESC NULLS LAST, page.id DESC'));
});

test('filters bind parameters in order and limit/offset come last', () => {
  const q = buildJobsQuery({ filters: { keyword: 'rn', location: 'Austin', remote: 'true', provider: 'greenhouse', days: '7', employment_type: 'full_time', salary_min: '50000', limit: '10', offset: '30' } });
  assert.deepEqual(q.params, ['rn', '%Austin%', 'greenhouse', 7, 'full_time', '50000', 10, 30]);
  const t = norm(q.text);
  assert.ok(t.includes("j.tsv @@ plainto_tsquery('english', $1)"));
  assert.ok(t.includes('city ILIKE $2 OR region ILIKE $2 OR country ILIKE $2'));
  assert.ok(t.includes('j.remote = true'));
  assert.ok(t.includes('LIMIT $7 OFFSET $8'));
  assert.ok(!/JOIN company c ON j.company_id = c.id WHERE/.test(t), 'no company filter, so no inner company join');
});

test('company filter and excluded companies pull the company join into the page query', () => {
  const a = norm(buildJobsQuery({ filters: { company: 'acme' } }).text);
  assert.ok(/FROM job j JOIN company c ON j\.company_id = c\.id WHERE/.test(a));
  assert.ok(a.includes('c.name ILIKE $1'));
  const b = norm(buildJobsQuery({ exclusions: { excludedCompanies: ['acme'] } }).text);
  assert.ok(/FROM job j JOIN company c ON j\.company_id = c\.id WHERE/.test(b));
  assert.ok(b.includes('c.name_normalized != ALL($1::text[])'));
});

test('preference exclusions are parameterised and the US-only check needs a US location pref', () => {
  const q = buildJobsQuery({
    nonUs: NON_US,
    exclusions: { dismissedJobIds: [1, 2], excludedTitles: ['intern'], excludedLocations: ['Paris'], locationPref: ' United States ' },
  });
  assert.deepEqual(q.params.slice(0, 3), [[1, 2], ['intern'], ['Paris']]);
  const t = norm(q.text);
  assert.ok(t.includes('j.id != ALL($1::bigint[])'));
  assert.ok(t.includes('xl.city = ANY($3::text[])'));
  assert.ok(t.includes('(ca|on)') && t.includes("j.title !~* 'london'"));

  const nonUs = norm(buildJobsQuery({ nonUs: NON_US, exclusions: { locationPref: 'Germany' } }).text);
  assert.ok(!nonUs.includes('anyloc'));
  const noCfg = norm(buildJobsQuery({ exclusions: { locationPref: 'usa' } }).text);
  assert.ok(!noCfg.includes('anyloc'), 'without the non-US config the check is skipped rather than emitting broken SQL');
});

test('cache key differs by query and params, same for identical requests', () => {
  const h = (s) => createHash('sha1').update(s).digest('hex');
  const a = buildJobsQuery({ filters: { limit: '20' } });
  const b = buildJobsQuery({ filters: { limit: '20' } });
  const c = buildJobsQuery({ filters: { limit: '20', remote: 'true' } });
  const d = buildJobsQuery({ filters: { limit: '20', offset: '20' } });
  assert.equal(jobsCacheKey(a.text, a.params, h), jobsCacheKey(b.text, b.params, h));
  assert.notEqual(jobsCacheKey(a.text, a.params, h), jobsCacheKey(c.text, c.params, h));
  assert.notEqual(jobsCacheKey(a.text, a.params, h), jobsCacheKey(d.text, d.params, h));
});

test('limiter caps concurrency and releases waiters in order', async () => {
  const limited = createLimiter(2);
  let active = 0, peak = 0;
  const gates = [];
  const run = (i) => limited(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => gates.push(r));
    active--; return i;
  });
  const ps = [0, 1, 2, 3].map(run);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(active, 2);
  while (gates.length || active) { gates.shift()?.(); await new Promise(r => setTimeout(r, 5)); }
  assert.deepEqual(await Promise.all(ps), [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test('limiter frees its slot when the job throws', async () => {
  const limited = createLimiter(1);
  await assert.rejects(limited(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await limited(async () => 'ok'), 'ok');
});

// The behaviour the incident needed: after the first load, nobody waits on the slow query again.
test('stale-while-revalidate: expiry serves the old page instantly and refreshes once in the background', async () => {
  const store = new Map();
  const redis = { get: async k => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
  let t = 1_000_000;
  const cache = createFeedCache({ redis, ttlMs: 60_000, staleMs: 600_000, prefix: 'jobs:v1:', now: () => t, l1Disabled: true });
  let loads = 0;
  let release;
  const slow = () => { loads++; return new Promise(r => { release = () => r({ jobs: [loads], n: loads }); }); };

  const first = cache.getOrLoad('k', slow);          // cold: pays the load
  await new Promise(r => setTimeout(r, 5));
  release();
  assert.equal((await first).status, 'MISS');
  assert.equal((await cache.getOrLoad('k', slow)).status, 'HIT');
  assert.equal(loads, 1);

  t += 61_000;                                        // fresh window over
  const herd = await Promise.all([1, 2, 3, 4, 5].map(() => cache.getOrLoad('k', slow)));
  assert.ok(herd.every(r => r.status === 'STALE' && r.value.n === 1), 'every caller gets the stale page without waiting');
  assert.equal(loads, 2, 'five concurrent callers trigger exactly one refresh');
  release();
  await new Promise(r => setTimeout(r, 5));
  const after = await cache.getOrLoad('k', slow);
  assert.equal(after.status, 'HIT');
  assert.equal(after.value.n, 2);
});

test('concurrent cold requests for one key share a single load', async () => {
  const cache = createFeedCache({ redis: null, ttlMs: 60_000, staleMs: 600_000, l1Disabled: true });
  let loads = 0;
  const load = async () => { loads++; await new Promise(r => setTimeout(r, 10)); return { ok: true }; };
  const rs = await Promise.all([1, 2, 3, 4].map(() => cache.getOrLoad('k', load)));
  assert.equal(loads, 1);
  assert.ok(rs.every(r => r.value.ok));
});

test('warmer refreshes the hot keys on demand, survives a failing load, and stops', async () => {
  const seen = []; const warnings = [];
  const w = startJobsWarmer({
    cache: { refresh: async (key, load) => { seen.push(key); return load(); } },
    hotKeys: () => [{ key: 'a', load: async () => { throw new Error('db down'); } }, { key: 'b', load: async () => 1 }],
    intervalMs: 3_600_000, initialDelayMs: 3_600_000,
    logger: { warn: (...a) => warnings.push(a) },
  });
  await w.warmOnce();
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(warnings.length, 1);
  w.stop();
  await w.warmOnce();
  assert.deepEqual(seen, ['a', 'b']);
});
