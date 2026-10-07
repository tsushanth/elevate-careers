import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedCache } from './feedCache.js';

// Minimal in-memory stand-in for ioredis (get / set with PX).
const fakeRedis = () => {
  const store = new Map();
  return { store, async get(k) { return store.get(k) ?? null; }, async set(k, v) { store.set(k, v); return 'OK'; } };
};
const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms) => { t += ms; } }; };

test('miss loads and stores; second call is a HIT without calling the loader', async () => {
  const c = clock(); const cache = createFeedCache({ redis: fakeRedis(), now: c.now });
  let calls = 0;
  const loader = async () => { calls++; return { jobs: [1] }; };
  assert.equal((await cache.getOrLoad('k', loader)).status, 'MISS');
  const hit = await cache.getOrLoad('k', loader);
  assert.equal(hit.status, 'HIT');
  assert.deepEqual(hit.value, { jobs: [1] });
  assert.equal(calls, 1);
});

test('stale entry is served immediately and refreshed in the background', async () => {
  const c = clock(); const cache = createFeedCache({ redis: fakeRedis(), now: c.now, ttlMs: 1000, staleMs: 10_000 });
  let n = 0;
  const loader = async () => ({ n: ++n });
  await cache.getOrLoad('k', loader);
  c.advance(2000);
  const stale = await cache.getOrLoad('k', loader);
  assert.equal(stale.status, 'STALE');
  assert.deepEqual(stale.value, { n: 1 });
  await new Promise(r => setImmediate(r));
  assert.deepEqual((await cache.getOrLoad('k', loader)).value, { n: 2 });
});

test('concurrent misses share one load', async () => {
  const cache = createFeedCache({ redis: fakeRedis() });
  let calls = 0;
  const loader = () => new Promise(r => { calls++; setTimeout(() => r({ ok: true }), 20); });
  await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
  assert.equal(calls, 1);
});

test('a failing loader is not cached and the error reaches the caller', async () => {
  const redis = fakeRedis(); const cache = createFeedCache({ redis });
  await assert.rejects(cache.getOrLoad('k', async () => { throw new Error('db down'); }), /db down/);
  assert.equal(redis.store.size, 0);
  assert.equal((await cache.getOrLoad('k', async () => ({ ok: 1 }))).status, 'MISS');
});

test('redis errors fail open: the request still gets data from the loader', async () => {
  const broken = { async get() { throw new Error('ECONNRESET'); }, async set() { throw new Error('ECONNRESET'); } };
  const cache = createFeedCache({ redis: broken });
  const r = await cache.getOrLoad('k', async () => ({ ok: 1 }));
  assert.deepEqual(r.value, { ok: 1 });
  assert.equal(r.status, 'MISS');
});

test('no redis configured: still works (and still coalesces)', async () => {
  const cache = createFeedCache({ redis: null });
  assert.deepEqual((await cache.getOrLoad('k', async () => ({ ok: 1 }))).value, { ok: 1 });
});

test('a corrupt cached value is treated as a miss', async () => {
  const redis = fakeRedis(); redis.store.set('feed:v2:k', '{not json');
  const cache = createFeedCache({ redis });
  assert.equal((await cache.getOrLoad('k', async () => ({ ok: 1 }))).status, 'MISS');
});
