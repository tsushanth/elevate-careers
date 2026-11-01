import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitor } from './monitoring.js';
import { _setSink } from '../utils/failureReporter.js';

const HOUR = 3600_000;
function fakeDb({ ageH = 1, fills = 0, nsi = 0, fail = false } = {}) {
  return { query: async (sql) => {
    if (fail) throw new Error('db down');
    if (sql.includes('discovered_company')) return { rows: [{ age_h: ageH }] };
    if (sql.includes('not signed in')) return { rows: [{ n: nsi }] };
    return { rows: [{ n: fills }] };
  } };
}
const mk = (opts) => { const reports = []; let t = 1_000_000_000; const m = createMonitor({ db: fakeDb(opts), report: (f, e, c) => reports.push({ f, m: e.message, c }), now: () => t }); return { m, reports, advance: (ms) => { t += ms; } }; };

test('fresh ingest and quiet extension: no alerts', async () => {
  const { m, reports } = mk(); const r = await m.check();
  assert.deepEqual(r.alerts, []); assert.equal(reports.length, 0);
});

test('stale ingest alerts once per 12 h, counts only', async () => {
  const { m, reports, advance } = mk({ ageH: 49.6 });
  assert.deepEqual((await m.check()).alerts, ['INGEST_STALE']);
  assert.deepEqual(reports, [{ f: 'monitor', m: 'INGEST_STALE', c: { age_hours: '50', limit_hours: '30' } }]);
  assert.deepEqual((await m.check()).alerts, []);
  advance(12 * HOUR + 1); assert.deepEqual((await m.check()).alerts, ['INGEST_STALE']);
});

test('no ingest ever recorded counts as stale', async () => {
  const { m, reports } = mk({ ageH: null }); await m.check();
  assert.equal(reports[0].m, 'INGEST_STALE'); assert.equal(reports[0].c.age_hours, 'never');
});

test('extension fill-failure spike and not-signed-in surge each alert', async () => {
  const { m, reports } = mk({ fills: 40, nsi: 33 }); await m.check();
  assert.deepEqual(reports.map((r) => [r.m, r.c]), [['EXTENSION_FILL_FAILURES_HIGH', { failures_1h: '40' }], ['EXTENSION_NOT_SIGNED_IN', { failures_24h: '33' }]]);
});

test('a database error never throws and never alerts', async () => {
  const w = console.warn; console.warn = () => {};
  try { const { m, reports } = mk({ fail: true }); assert.equal(await m.check(), null); assert.equal(reports.length, 0); } finally { console.warn = w; }
});

