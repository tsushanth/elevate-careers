// Stale-while-revalidate cache with request coalescing. Every Redis call is
// wrapped: on any error we behave as if the cache were empty.
export function createFeedCache({ redis, ttlMs = 60_000, staleMs = 300_000, now = Date.now, prefix = 'feed:v2:' }) {
  const inflight = new Map();

  async function read(key) {
    if (!redis) return null;
    try {
      const raw = await redis.get(prefix + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.t === 'number' ? parsed : null;
    } catch { return null; }
  }

  async function write(key, value) {
    if (!redis) return;
    try { await redis.set(prefix + key, JSON.stringify({ t: now(), v: value }), 'PX', ttlMs + staleMs); } catch { /* fail open */ }
  }

  function load(key, loader) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { const v = await loader(); await write(key, v); return v; })()
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return {
    async getOrLoad(key, loader) {
      const hit = await read(key);
      if (hit) {
        if (now() - hit.t <= ttlMs) return { value: hit.v, status: 'HIT' };
        load(key, loader).catch(() => {}); // refresh in the background
        return { value: hit.v, status: 'STALE' };
      }
      return { value: await load(key, loader), status: 'MISS' };
    },
    refresh: (key, loader) => load(key, loader),
  };
}
