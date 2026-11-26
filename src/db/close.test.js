import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './index.js';

test('closing twice (SIGINT then SIGTERM on a deploy) ends the pool once and rejects nothing', async () => {
  let ends = 0;
  db.pool = { end: async () => { if (++ends > 1) throw new Error('Called end on pool more than once'); } };
  await Promise.all([db.close(), db.close()]);
  await db.close();
  assert.equal(ends, 1);
});
