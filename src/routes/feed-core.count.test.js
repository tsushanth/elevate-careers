// No database needed: the signed-in count arithmetic, its fallbacks, and the cache-bypass invariant
// for the plain-place path (the one that now runs an extra count query).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';
import { EXACT_EXCLUSION_MAX, COUNT_CAP } from '../services/feedQuery.js';

// Fake db: geo_place lookup -> base, exclusion query -> `excluded`, capped count -> `capped`.
function fakeDb({ base = 69423, excluded = 0, capped = 5, failExcluded = false } = {}) {
  const seen = [];
  return {
    seen,
    async query(text) {
      seen.push(text);
      if (/FROM geo_place/.test(text)) return { rows: base === null ? [] : [{ job_count: base }] };
      if (/AS posted_at/.test(text)) return { rows: [] };
      if (/count\(\*\) FROM job_feed/.test(text) || /^SELECT 0::int/.test(text)) {
        if (failExcluded) throw new Error('boom');
        return { rows: [{ n: excluded }] };
      }
      return { rows: [{ n: capped }] };
    },
  };
}

async function run(db, exclusions, path = '/jobs/feed?country=US') {
  const redisOps = [];
  const redis = { async get(k) { redisOps.push(['get', k]); return null; }, async set(k) { redisOps.push(['set', k]); return 'OK'; } };
  const cache = createFeedCache({ redis, logger: { warn() {} } });
  const app = express();
  app.use('/v2', createFeedRouter({ db, cache, getExclusions: async () => exclusions, logger: { warn() {}, error() {} } }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v2${path}`, { headers: { authorization: 'Bearer x' } });
    return { body: await r.json(), cache: r.headers.get('x-cache'), l1: cache._l1Size(), redisOps };
  } finally { server.close(); }
}

test('exact signed-in count = place count minus excluded rows in the filter', async () => {
  const r = await run(fakeDb({ base: 69423, excluded: 23 }), { dismissed: [1, 2], excludedCompanies: ['acme'] });
  assert.equal(r.body.count, 69400);
  assert.equal(r.body.countIsCapped, false);
});

test('exclusions outside the filter subtract nothing (equals the anonymous count)', async () => {
  const r = await run(fakeDb({ base: 69423, excluded: 0 }), { dismissed: [999], excludedCompanies: [] });
  assert.equal(r.body.count, 69423);
});

test('a lagging geo_place count never goes negative', async () => {
  const r = await run(fakeDb({ base: 3, excluded: 10 }), { dismissed: [1], excludedCompanies: [] });
  assert.equal(r.body.count, 0);
});

test('exclusion list over the limit falls back to the capped count without the extra query', async () => {
  const db = fakeDb({ base: 69423, capped: COUNT_CAP + 1 });
  const dismissed = Array.from({ length: EXACT_EXCLUSION_MAX + 1 }, (_, i) => i + 1);
  const r = await run(db, { dismissed, excludedCompanies: [] });
  assert.equal(r.body.count, COUNT_CAP);
  assert.equal(r.body.countIsCapped, true);
  assert.ok(!db.seen.some(t => /count\(\*\) FROM job_feed/.test(t)));
  // exactly at the limit is still exact
  const at = await run(fakeDb({ base: 100, excluded: 4 }), { dismissed: dismissed.slice(0, EXACT_EXCLUSION_MAX - 1), excludedCompanies: ['a'] });
  assert.equal(at.body.count, 96);
});

test('exclusion query failure or a missing place row falls back to the capped count', async () => {
  const failed = await run(fakeDb({ failExcluded: true, capped: 7 }), { dismissed: [1], excludedCompanies: [] });
  assert.equal(failed.body.count, 7);
  assert.equal(failed.body.countIsCapped, false);
  const noPlace = await run(fakeDb({ base: null, capped: COUNT_CAP + 1 }), { dismissed: [1], excludedCompanies: [] });
  assert.equal(noPlace.body.countIsCapped, true);
});

test('non-plain filters keep the capped count', async () => {
  const db = fakeDb({ capped: COUNT_CAP + 1 });
  const r = await run(db, { dismissed: [1], excludedCompanies: [] }, '/jobs/feed?country=US&remote=true');
  assert.equal(r.body.countIsCapped, true);
  assert.ok(!db.seen.some(t => /FROM geo_place/.test(t)));
});

test('invariant: the signed-in exact-count path never touches L1 or Redis', async () => {
  const r = await run(fakeDb({ excluded: 5 }), { dismissed: [1], excludedCompanies: [] });
  assert.equal(r.cache, 'BYPASS');
  assert.equal(r.l1, 0);
  assert.deepEqual(r.redisOps, []);
});
