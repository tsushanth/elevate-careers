import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { requireJobId } from './jobId.js';

test('only a numeric job id reaches the job query; anything else is 404', async () => {
  const seen = [];
  const app = express();
  app.get('/jobs/:id', requireJobId, (req, res) => { seen.push(req.params.id); res.json({ id: req.params.id }); });
  const server = app.listen(0);
  try {
    const status = async (id) => (await fetch(`http://127.0.0.1:${server.address().port}/jobs/${id}`)).status;
    assert.equal(await status('12345'), 200);
    for (const bad of ['feed?limit=1', 'undefined', '12abc', '-1', '1.5', '9'.repeat(30)]) assert.equal(await status(bad), 404, bad);
    assert.deepEqual(seen, ['12345']);
  } finally {
    server.close();
  }
});

test('server.js puts the guard on /jobs/:id', () => {
  const server = readFileSync(new URL('../api/server.js', import.meta.url), 'utf8');
  assert.match(server, /app\.get\('\/jobs\/:id', requireJobId,/);
});
