import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createSavedJobsRouter } from './saved-jobs-core.js';

// No database needed: a fake db records calls. Covers the save_job hook only.
async function withServer({ insertRowCount, onSaved }, fn) {
  const db = { query: async (sql) => (/FROM job WHERE/i.test(sql) || /SELECT 1 FROM job/i.test(sql) ? { rowCount: 1, rows: [{}] } : { rowCount: insertRowCount, rows: [] }) };
  const requireAuth = (req, _res, next) => { req.user = { id: 'u1' }; next(); };
  const app = express();
  app.use('/s', createSavedJobsRouter({ db, requireAuth, onSaved }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try { await fn(`http://127.0.0.1:${server.address().port}/s`); } finally { server.close(); }
}

test('onSaved fires for a newly saved job', async () => {
  let n = 0;
  await withServer({ insertRowCount: 1, onSaved: () => { n++; } }, async (base) => {
    const r = await fetch(`${base}/5`, { method: 'PUT' });
    assert.equal(r.status, 200);
  });
  assert.equal(n, 1);
});

test('onSaved does not fire when the job was already saved', async () => {
  let n = 0;
  await withServer({ insertRowCount: 0, onSaved: () => { n++; } }, async (base) => {
    assert.equal((await fetch(`${base}/5`, { method: 'PUT' })).status, 200);
  });
  assert.equal(n, 0);
});

test('a throwing or rejecting onSaved never breaks the response', async () => {
  await withServer({ insertRowCount: 1, onSaved: () => { throw new Error('x'); } }, async (base) => {
    assert.equal((await fetch(`${base}/5`, { method: 'PUT' })).status, 200);
  });
  await withServer({ insertRowCount: 1, onSaved: () => Promise.reject(new Error('x')) }, async (base) => {
    assert.equal((await fetch(`${base}/5`, { method: 'PUT' })).status, 200);
  });
});
