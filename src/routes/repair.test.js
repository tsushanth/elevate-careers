import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { db } from '../db/index.js';
import router, { queueBodyLimit } from './repair.js';

let server, base, queries = [], rows = [], reachedCatchAll = [];
before(() => {
  db.query = async (sql, params) => { queries.push({ sql, params }); return { rows }; };
  process.env.REPAIR_ADMIN_SECRET = 'test-only';
  const app = express();
  app.use('/api/repair/queue', queueBodyLimit);
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/repair', router);
  app.use((err, _req, res, _next) => { reachedCatchAll.push(err.type); res.status(500).end(); }); // as server.js ends
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/repair`;
});
after(() => server.close());
beforeEach(() => { queries = []; rows = []; reachedCatchAll = []; });

const report = async (body, ip = '10.0.0.1') => {
  const r = await fetch(`${base}/queue`, { method: 'POST', headers: { 'content-type': 'application/json', 'fly-client-ip': ip }, body: JSON.stringify(body) });
  await new Promise((res) => setTimeout(res, 10));
  return r.status;
};
const body = {
  domain: 'jobs.example.com', label: 'Phone', fieldType: 'tel', fillTried: 'fillStructured',
  failReason: 'no option for "+1 415-555-0142"', outerHTML: '<input type="tel" value="jo.person@example.com">',
};

test('a signed-out report is stored with no typed value', async () => {
  assert.equal(await report(body), 200);
  assert.deepEqual(queries[0].params, ['jobs.example.com', 'Phone', 'tel', '<input type="tel" value="[redacted]">', 'no option for "[redacted]"', 'fillStructured']);
});

test('a report with a bad domain or a non-string label is dropped', async () => {
  await report({ ...body, domain: 'not a host' });
  await report({ ...body, label: { a: 1 } });
  assert.equal(queries.length, 0);
});

test('a body over 64 KB is refused before it is stored', async () => {
  assert.equal(await report({ ...body, label: 'x'.repeat(70_000) }, '10.0.0.2'), 413);
  assert.equal(queries.length, 0);
  assert.deepEqual(reachedCatchAll, []);
});

test('a body that is not JSON is a 400 that never reaches the app-wide handler, which would log it', async () => {
  const r = await fetch(`${base}/queue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"failReason":"cut' });
  assert.equal(r.status, 400);
  assert.deepEqual(reachedCatchAll, []);
  assert.equal(queries.length, 0);
});

test('the largest report a shipped extension builds still fits', async () => {
  assert.equal(await report({ ...body, outerHTML: '"é'.repeat(1500), label: 'é'.repeat(600) }, '10.0.0.3'), 200);
  assert.equal(queries.length, 1);
});

test('one caller is limited to 120 reports a minute; others are not affected', async () => {
  const statuses = [];
  for (let i = 0; i < 121; i++) statuses.push(await report(body, '10.0.0.9'));
  assert.equal(statuses.filter((s) => s === 200).length, 120);
  assert.equal(statuses[120], 429);
  assert.equal(await report(body, '10.0.0.10'), 200);
});

test('the admin queue serves rows stored earlier with their values removed', async () => {
  rows = [{ domain: 'jobs.example.com', label: 'Email', fail_reason: 'no option for "jo.person@example.com"', outer_html: '<input value="+1 415-555-0142">', fill_tried: 'unknown', count: 1 }];
  const r = await fetch(`${base}/admin/queue`, { headers: { authorization: 'Bearer test-only' } });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.doesNotMatch(text, /@example|jo\.person|555-0142/);
  assert.equal(JSON.parse(text)[0].fail_reason, 'no option for "[redacted]"');
});

test('server.js mounts the small limit ahead of the large one', () => {
  const s = readFileSync(new URL('../api/server.js', import.meta.url), 'utf8');
  const small = s.indexOf("app.use('/api/repair/queue', queueBodyLimit)");
  assert.ok(small > 0 && small < s.indexOf("app.use(express.json({ limit: '10mb' }))"));
});
