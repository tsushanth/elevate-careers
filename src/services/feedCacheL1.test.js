import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedCache } from './feedCache.js';
import { createThrottledWarn } from './redis.js';

const fakeRedis = () => {
  const store = new Map();
  return { store, gets: 0, async get(k) { this.gets++; return store.get(k) ?? null; }, async set(k, v) { store.set(k, v); return 'OK'; } };
};
const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms) => { t += ms; } }; };
const silent = () => ({ calls: [], warn(...a) { this.calls.push(a); } });
const tick = () => new Promise(r => setImmediate(r));

afterEach(() => { delete process.env.FEED_L1_DISABLED; });

test('L1 hit skips Redis; expires after l1TtlMs and falls back to Redis HIT', async () => {
  const c = clock(); const redis = fakeRedis();
  const cache = createFeedCache({ redis, now: c.now, logger: silent() });
  let calls = 0; const loader = async () => ({ n: ++calls });
  assert.equal((await cache.getOrLoad('k', loader)).status, 'MISS');
  await tick();
  const getsAfterMiss = redis.gets;
  assert.equal((await cache.getOrLoad('k', loader)).status, 'HIT-L1');
  assert.equal(redis.gets, getsAfterMiss, 'L1 hit must not touch Redis');
  c.advance(5_001);
  const r = await cache.getOrLoad('k', loader);
  assert.equal(r.status, 'HIT'); // Redis still fresh (60 s)
  assert.equal(calls, 1);
  assert.equal((await cache.getOrLoad('k', loader)).status, 'HIT'); // data is >5 s old, so L1 is not repopulated with it
});

test('L1 never extends freshness beyond ttlMs', async () => {
  const c = clock();
  const cache = createFeedCache({ redis: fakeRedis(), now: c.now, ttlMs: 1000, staleMs: 10_000, l1TtlMs: 5000, logger: silent() });
  await cache.getOrLoad('k', async () => 1);
  c.advance(1001);
  assert.equal((await cache.getOrLoad('k', async () => 2)).status, 'STALE');
});

test('L1 is bounded and evicts least recently used', async () => {
  const c = clock();
  const cache = createFeedCache({ redis: null, now: c.now, l1Max: 3, logger: silent() });
  for (const k of ['a', 'b', 'c']) await cache.getOrLoad(k, async () => k);
  await cache.getOrLoad('a', async () => 'x'); // bump a; b is now LRU
  await cache.getOrLoad('d', async () => 'd'); // evicts b
  assert.equal(cache._l1Size(), 3);
  let reloaded = false;
  assert.equal((await cache.getOrLoad('a', async () => 'x')).status, 'HIT-L1');
  const b = await cache.getOrLoad('b', async () => { reloaded = true; return 'b2'; });
  assert.equal(b.status, 'MISS'); assert.ok(reloaded);
  for (let i = 0; i < 50; i++) await cache.getOrLoad('k' + i, async () => i);
  assert.equal(cache._l1Size(), 3);
});

test('single-flight: a cold burst runs the loader once, even with no Redis', async () => {
  for (const redis of [null, fakeRedis()]) {
    const cache = createFeedCache({ redis, logger: silent() });
    let calls = 0;
    const loader = () => new Promise(r => { calls++; setTimeout(() => r({ ok: 1 }), 20); });
    const rs = await Promise.all(Array.from({ length: 20 }, () => cache.getOrLoad('k', loader)));
    assert.equal(calls, 1);
    assert.ok(rs.every(r => r.value.ok === 1));
  }
});

test('single-flight errors reach every waiter and are not cached in L1', async () => {
  const cache = createFeedCache({ redis: null, logger: silent() });
  const loader = () => new Promise((_, rej) => setTimeout(() => rej(new Error('db down')), 10));
  const rs = await Promise.allSettled([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
  assert.ok(rs.every(r => r.status === 'rejected'));
  assert.equal(cache._l1Size(), 0);
  assert.equal((await cache.getOrLoad('k', async () => 1)).status, 'MISS');
});

test('kill switch FEED_L1_DISABLED=1 restores Redis-only behaviour', async () => {
  process.env.FEED_L1_DISABLED = '1';
  const redis = fakeRedis();
  const cache = createFeedCache({ redis, logger: silent() });
  await cache.getOrLoad('k', async () => 1);
  await tick();
  assert.equal(cache._l1Size(), 0);
  assert.equal((await cache.getOrLoad('k', async () => 2)).status, 'HIT');
  const off = createFeedCache({ redis: null, l1Disabled: true, logger: silent() });
  await off.getOrLoad('k', async () => 1);
  assert.equal(off._l1Size(), 0);
});

test('background refresh failure is logged once per key per minute', async () => {
  const c = clock(); const log = silent();
  const cache = createFeedCache({ redis: fakeRedis(), now: c.now, ttlMs: 1000, staleMs: 10_000, l1Disabled: true, logger: log });
  await cache.getOrLoad('k', async () => 1);
  const bad = async () => { throw new Error('db timeout'); };
  c.advance(2000);
  assert.equal((await cache.getOrLoad('k', bad)).status, 'STALE');
  await tick(); await tick();
  assert.equal(log.calls.length, 1);
  assert.equal(log.calls[0][0].key, 'k');
  assert.match(log.calls[0][0].error, /db timeout/);
  await cache.getOrLoad('k', bad); await tick(); await tick();
  assert.equal(log.calls.length, 1, 'throttled within 60 s');
  await cache.getOrLoad('other', async () => 1);
  c.advance(60_001);
  await cache.getOrLoad('k', bad); await tick(); await tick();
  assert.equal(log.calls.length, 2, 'logs again after a minute');
});

test('a throwing logger cannot break the request path', async () => {
  const c = clock();
  const cache = createFeedCache({ redis: fakeRedis(), now: c.now, ttlMs: 1000, staleMs: 10_000, l1Disabled: true, logger: { warn() { throw new Error('log'); } } });
  await cache.getOrLoad('k', async () => 1);
  c.advance(2000);
  assert.equal((await cache.getOrLoad('k', async () => { throw new Error('x'); })).status, 'STALE');
  await tick(); await tick();
});

test('redis error warnings are throttled to one per 30 s with suppressed count', () => {
  const c = clock(); const log = silent();
  const warn = createThrottledWarn(log, 30_000, c.now);
  for (let i = 0; i < 5; i++) warn({ error: 'ECONNREFUSED' }, 'm');
  assert.equal(log.calls.length, 1);
  c.advance(30_000);
  warn({ error: 'ECONNREFUSED' }, 'm');
  assert.equal(log.calls.length, 2);
  assert.equal(log.calls[1][0].suppressed, 4);
  assert.equal(log.calls[0][0].suppressed, undefined);
});
