// No database needed: proves per-user (exclusion) requests never touch the shared cache, hence never L1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createFeedRouter } from './feed-core.js';
import { createFeedCache } from '../services/feedCache.js';

test('user-specific feed requests never read or write L1 (or Redis)', async () => {
  const redisOps = [];
  const redis = { async get(k) { redisOps.push(['get', k]); return null; }, async set(k) { redisOps.push(['set', k]); return 'OK'; } };
  const cache = createFeedCache({ redis, logger: { warn() {} } });
  const db = { async query() { return { rows: [{ n: 0 }] }; } };
  const app = express();
  app.use('/v2', createFeedRouter({
    db, cache,
    getExclusions: async () => ({ dismissed: [1], excludedCompanies: [] }),
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v2/jobs/feed`;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(url, { headers: { authorization: 'Bearer x' } });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-cache'), 'BYPASS');
    }
    assert.equal(cache._l1Size(), 0);
    assert.deepEqual(redisOps, []);
    // An anonymous request does populate L1, proving the assertions above are meaningful.
    const anon = await fetch(url);
    assert.equal(anon.status, 200);
    assert.equal(cache._l1Size(), 1);
    assert.equal((await fetch(url)).headers.get('x-cache'), 'HIT-L1');
  } finally { server.close(); }
});
