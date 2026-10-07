import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotFeedQueries, startFeedWarmer } from './feedWarmer.js';

const fakeDb = (countries) => ({ async query() { return { rows: countries.map(c => ({ country_code: c })) }; } });

test('hot queries are worldwide plus the top countries', async () => {
  const q = await hotFeedQueries(fakeDb(['US', 'GB', 'CA']));
  assert.deepEqual(q, [{}, { country: 'US' }, { country: 'GB' }, { country: 'CA' }]);
});

test('warmer refreshes each hot query on start and swallows failures', async () => {
  const seen = []; const warnings = [];
  const w = startFeedWarmer({
    db: fakeDb(['US', 'GB']),
    cache: { refresh: async (key, loader) => { seen.push(key); if (key.includes('"GB"')) throw new Error('boom'); return loader(); } },
    loadPage: async () => ({ jobs: [] }),
    rebuildPlaces: async () => { seen.push('places'); },
    intervalMs: 3_600_000, placeIntervalMs: 3_600_000,
    logger: { warn: (...a) => warnings.push(a), info() {} },
  });
  await new Promise(r => setTimeout(r, 30));
  w.stop();
  assert.equal(seen.filter(k => k.startsWith('[')).length, 3);   // worldwide, US, GB
  assert.ok(seen.includes('places'));
  assert.equal(warnings.length, 1);                              // GB failure logged, not thrown
});

test('stop() prevents further ticks', async () => {
  let ticks = 0;
  const w = startFeedWarmer({
    db: fakeDb([]), cache: { refresh: async () => { ticks++; } }, loadPage: async () => ({}),
    rebuildPlaces: async () => {}, intervalMs: 10, placeIntervalMs: 3_600_000,
    logger: { warn() {}, info() {} },
  });
  await new Promise(r => setTimeout(r, 35));
  w.stop();
  const after = ticks;
  await new Promise(r => setTimeout(r, 40));
  assert.equal(ticks, after);
});
