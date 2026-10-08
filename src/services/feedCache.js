// Two-level stale-while-revalidate cache with request coalescing.
//
//   L1: tiny in-process Map (bounded, LRU-ish, short TTL) in front of
//   L2: Redis (fresh for ttlMs, stale-servable for a further staleMs).
//
// Status values returned by getOrLoad (surfaced as the X-Cache header):
//   HIT-L1  served from the in-process cache (data at most l1TtlMs old)
//   HIT     fresh Redis entry
//   STALE   stale Redis entry served; a background refresh was started
//   MISS    loaded from the source
// HIT-L1 is new; HIT/STALE/MISS/BYPASS are unchanged. Nothing in the repo
// branches on the header value (it is informational for ops/debugging).
//
// Safety:
//  - L1 holds only what goes through getOrLoad(key). Per-user feeds never do
//    (feed-core.js answers those with X-Cache: BYPASS before touching the cache).
//  - L1 never extends freshness: effective L1 TTL = min(l1TtlMs, ttlMs), and an
//    entry keeps the timestamp of the data it holds.
//  - Cached values are shared by reference; callers must not mutate them.
//  - Every L1 operation is wrapped; any problem behaves as an L1 miss.
//  - Kill switch: FEED_L1_DISABLED=1 (checked on every call) or l1Disabled option.
//
// Every Redis call is wrapped: on any error we behave as if the cache were empty.
// Cache writes are not awaited on the request path. Reads are raced against
// readTimeoutMs: if redis.get doesn't resolve in time, treated as miss.
import defaultLogger from '../utils/logger.js';

const WARN_INTERVAL_MS = 60_000;
const MAX_WARN_KEYS = 1000;

export function createFeedCache({
  redis, ttlMs = 60_000, staleMs = 300_000, now = Date.now, prefix = 'feed:v2:', readTimeoutMs = 100,
  l1TtlMs = 5_000, l1Max = 500, l1Disabled, logger = defaultLogger,
}) {
  const inflight = new Map();
  const l1 = new Map(); // key -> { t, v }; Map insertion order = recency (re-inserted on hit)
  const lastWarn = new Map(); // key -> ms of last refresh-failure log
  const l1Ttl = Math.min(l1TtlMs, ttlMs);

  const l1Off = () => (l1Disabled !== undefined ? !!l1Disabled : process.env.FEED_L1_DISABLED === '1') || !(l1Max > 0) || !(l1Ttl > 0);

  function l1Get(key) {
    try {
      if (l1Off()) return null;
      const e = l1.get(key);
      if (!e) return null;
      if (now() - e.t > l1Ttl) { l1.delete(key); return null; }
      l1.delete(key); l1.set(key, e); // bump recency
      return e;
    } catch { return null; }
  }

  function l1Set(key, t, v) {
    try {
      if (l1Off()) return;
      l1.delete(key);
      l1.set(key, { t, v });
      while (l1.size > l1Max) l1.delete(l1.keys().next().value); // evict least recently used
    } catch { /* fail open */ }
  }

  function warnRefreshFailure(key, err) {
    try {
      const t = now();
      const prev = lastWarn.get(key);
      if (prev !== undefined && t - prev < WARN_INTERVAL_MS) return;
      if (lastWarn.size >= MAX_WARN_KEYS) {
        for (const [k, at] of lastWarn) if (t - at >= WARN_INTERVAL_MS) lastWarn.delete(k);
        if (lastWarn.size >= MAX_WARN_KEYS) lastWarn.clear();
      }
      lastWarn.set(key, t);
      logger.warn({ key, error: err?.message ?? String(err) }, 'feed cache background refresh failed');
    } catch { /* logging must never throw */ }
  }

  async function read(key) {
    if (!redis) return null;
    try {
      let timer;
      const racePromise = Promise.race([
        redis.get(prefix + key).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('read timeout')), readTimeoutMs);
        }),
      ]);
      const raw = await racePromise;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.t === 'number' ? parsed : null;
    } catch { return null; }
  }

  async function write(key, t, value) {
    if (!redis) return;
    try { await redis.set(prefix + key, JSON.stringify({ t, v: value }), 'PX', ttlMs + staleMs); } catch { /* fail open */ }
  }

  // Single-flight: concurrent callers for a key share one loader promise. L1 is
  // filled synchronously before the in-flight entry is released, so there is no
  // window where a latecomer misses both.
  function load(key, loader) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const v = await loader();
      const t = now();
      l1Set(key, t, v);
      write(key, t, v).catch(() => {});
      return v;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return {
    async getOrLoad(key, loader) {
      const mem = l1Get(key);
      if (mem) return { value: mem.v, status: 'HIT-L1' };
      const hit = await read(key);
      if (hit) {
        if (now() - hit.t <= ttlMs) {
          l1Set(key, hit.t, hit.v);
          return { value: hit.v, status: 'HIT' };
        }
        load(key, loader).catch((e) => warnRefreshFailure(key, e)); // refresh in the background
        return { value: hit.v, status: 'STALE' };
      }
      return { value: await load(key, loader), status: 'MISS' };
    },
    refresh: (key, loader) => load(key, loader),
    _l1Size: () => l1.size,
  };
}
