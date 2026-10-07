// Wiring test: proves /v2 and /ingest are mounted and guarded, with no SQL,
// no warmer, and no production resource.
process.env.FEED_WARMER = 'off';
process.env.INGEST_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:54329/postgres';
process.env.LOG_LEVEL = 'silent';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { default: feedRouter, ingestRouter } = await import('./feed.js');
const { db } = await import('../db/index.js');

let server; let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v2', feedRouter);
  app.use('/ingest', ingestRouter);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  await db.close();
});

test('GET /v2/jobs/feed rejects a non-ISO2 country with 400', async () => {
  const res = await fetch(`${base}/v2/jobs/feed?country=USA`);
  assert.equal(res.status, 400);
});

test('GET /v2/jobs/feed rejects a garbage cursor with 400', async () => {
  const res = await fetch(`${base}/v2/jobs/feed?cursor=garbage`);
  assert.equal(res.status, 400);
});

test('POST /ingest/rebuild-geo-places rejects a wrong secret with 401', async () => {
  const res = await fetch(`${base}/ingest/rebuild-geo-places`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'nope' }),
  });
  assert.equal(res.status, 401);
});

test('POST /ingest/rebuild-geo-places rejects a missing body with 401', async () => {
  const res = await fetch(`${base}/ingest/rebuild-geo-places`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /ingest/rebuild-geo-places is closed (401) when INGEST_SECRET is unset', async () => {
  const saved = process.env.INGEST_SECRET;
  delete process.env.INGEST_SECRET;
  try {
    const res = await fetch(`${base}/ingest/rebuild-geo-places`, { method: 'POST' });
    assert.equal(res.status, 401);
    const res2 = await fetch(`${base}/ingest/rebuild-geo-places`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res2.status, 401);
  } finally {
    process.env.INGEST_SECRET = saved;
  }
});
