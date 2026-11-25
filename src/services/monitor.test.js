import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './monitor.js';

test('a failing queue does not stop the database checks', async () => {
  const seen = [];
  const db = { query: async (text) => { seen.push(text); return { rows: [{ newest: new Date(), stuck: 0, failed_recent: 0, finished_recent: 0 }] }; } };
  const queue = { getJobCounts: async () => { throw new Error('Connection is closed.'); }, getJobs: async () => [] };
  await runChecks({ db, queue });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /WHERE is_active/);
  assert.match(seen[1], /not_submitted/);
});

test('a failing freshness query does not stop the apply check', async () => {
  let calls = 0;
  const db = { query: async () => { calls += 1; if (calls === 1) throw new Error('timeout'); return { rows: [{ stuck: 0, failed_recent: 0, finished_recent: 0 }] }; } };
  await runChecks({ db, queue: null });
  assert.equal(calls, 2);
});
