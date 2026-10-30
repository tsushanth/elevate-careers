import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordApplication, reportOutcome, stageOf, normUrl, fillStatus, OPEN_WINDOW_MS } from './applicationTracker.js';

// Minimal in-memory stand-in for the supabase client chain used by the tracker.
function fakeSb(rows = []) {
  const state = { rows, inserts: [], updates: [], nextId: 100 };
  const sb = {
    state,
    from(table) {
      assert.equal(table, 'job_applications');
      const q = { filters: [], op: 'select', patch: null };
      const api = {
        select() { return api; },
        eq(k, v) { q.filters.push((r) => r[k] === v); return api; },
        gte(k, v) { q.filters.push((r) => r[k] >= v); return api; },
        order() { return api; },
        limit() { return api; },
        insert(row) { q.op = 'insert'; q.patch = row; return api; },
        update(patch) { q.op = 'update'; q.patch = patch; return api; },
        single: async () => { const id = state.nextId++; state.inserts.push({ id, ...q.patch }); state.rows.push({ id, created_at: new Date(Date.now()).toISOString(), ...q.patch }); return { data: { id }, error: null }; },
        then(res, rej) {
          let out;
          if (q.op === 'update') {
            state.rows.filter((r) => q.filters.every((f) => f(r))).forEach((r) => { Object.assign(r, q.patch); state.updates.push({ id: r.id, ...q.patch }); });
            out = { error: null };
          } else {
            out = { data: state.rows.filter((r) => q.filters.every((f) => f(r))).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return api;
    },
  };
  return sb;
}

const NOW = Date.parse('2026-10-30T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const resolve = (id) => async () => id;

test('stageOf: explicit stage wins; old clients are told apart by a numeric fieldCount', () => {
  assert.equal(stageOf({ stage: 'opened', fieldCount: 5 }), 'opened');
  assert.equal(stageOf({ stage: 'filled' }), 'filled');
  assert.equal(stageOf({ fieldCount: 0 }), 'filled');
  assert.equal(stageOf({ jobUrl: 'x' }), 'opened');
  assert.equal(stageOf({ stage: 'weird', fieldCount: 3 }), 'filled');
});

test('normUrl drops query, hash and trailing slashes; fillStatus', () => {
  assert.equal(normUrl('https://a.com/j/1/?gh_jid=2#top'), 'https://a.com/j/1');
  assert.equal(normUrl(null), '');
  assert.equal(fillStatus(0), 'fill_empty');
  assert.equal(fillStatus(undefined), 'fill_empty');
  assert.equal(fillStatus(3), 'filled');
});

test('a web click is stored as opened/web_click with zero fill counts', async () => {
  const sb = fakeSb();
  const r = await recordApplication({ sb, resolveJobId: resolve(7), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/1', jobTitle: 'T', company: 'C', stage: 'opened' } });
  assert.deepEqual(r, { id: 100, merged: false });
  assert.equal(sb.state.inserts.length, 1);
  const row = sb.state.inserts[0];
  assert.equal(row.status, 'opened');
  assert.equal(row.source, 'web_click');
  assert.equal(row.job_id, 7);
  assert.equal(row.fields_filled, 0);
});

test('a second click on the same job does not create a second application', async () => {
  const sb = fakeSb([{ id: 5, user_id: 'u1', status: 'opened', job_id: 7, job_url: 'https://a.com/j/1', created_at: iso(NOW - 60000) }]);
  const r = await recordApplication({ sb, resolveJobId: resolve(7), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/1', stage: 'opened' } });
  assert.deepEqual(r, { id: 5, merged: true });
  assert.equal(sb.state.inserts.length, 0);
});

test('a fill report merges into the recent opened row (matched by job id) and updates counts and status', async () => {
  const sb = fakeSb([{ id: 5, user_id: 'u1', status: 'opened', job_id: 7, job_url: 'https://a.com/j/1', created_at: iso(NOW - 60000) }]);
  const r = await recordApplication({ sb, resolveJobId: resolve(7), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://apply.a.com/other?x=1', fieldCount: 12, filled: 9, skipped: 2, errors: 1, aiUsed: true } });
  assert.deepEqual(r, { id: 5, merged: true });
  assert.equal(sb.state.inserts.length, 0);
  assert.deepEqual(sb.state.updates[0], { id: 5, field_count: 12, ai_used: true, fields_filled: 9, fields_skipped: 2, fields_errored: 1, status: 'filled', filled_at: iso(NOW) });
});

test('a fill report also merges by normalised URL when the job id is unknown', async () => {
  const sb = fakeSb([{ id: 6, user_id: 'u1', status: 'opened', job_id: null, job_url: 'https://a.com/j/1?utm=x', created_at: iso(NOW - 1000) }]);
  const r = await recordApplication({ sb, resolveJobId: resolve(null), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/1/', fieldCount: 4, filled: 0, skipped: 4, errors: 0 } });
  assert.equal(r.merged, true);
  assert.equal(sb.state.updates[0].status, 'fill_empty');
  assert.equal(sb.state.updates[0].fields_filled, 0);
});

test('a fill report with no matching click inserts its own filled row (extension used without the web button)', async () => {
  const sb = fakeSb();
  const r = await recordApplication({ sb, resolveJobId: resolve(null), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/9', fieldCount: 3, filled: 3, skipped: 0, errors: 0 } });
  assert.deepEqual(r, { id: 100, merged: false });
  assert.equal(sb.state.inserts[0].status, 'filled');
  assert.equal(sb.state.inserts[0].fields_filled, 3);
});

test('an opened row older than 24h, or another user\'s row, is never merged into', async () => {
  const old = { id: 1, user_id: 'u1', status: 'opened', job_id: 7, job_url: 'https://a.com/j/1', created_at: iso(NOW - OPEN_WINDOW_MS - 1000) };
  const other = { id: 2, user_id: 'u2', status: 'opened', job_id: 7, job_url: 'https://a.com/j/1', created_at: iso(NOW - 1000) };
  const sb = fakeSb([old, other]);
  const r = await recordApplication({ sb, resolveJobId: resolve(7), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/1', fieldCount: 2, filled: 2 } });
  assert.equal(r.merged, false);
  assert.equal(sb.state.updates.length, 0);
});

test('negative or non-numeric counts are stored as zero', async () => {
  const sb = fakeSb();
  await recordApplication({ sb, resolveJobId: resolve(null), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/9', fieldCount: 2, filled: -5, skipped: 'x', errors: NaN } });
  const row = sb.state.inserts[0];
  assert.equal(row.fields_filled, 0); assert.equal(row.fields_skipped, 0); assert.equal(row.fields_errored, 0);
  assert.equal(row.status, 'fill_empty');
});

test('a database error is thrown so the route can answer 500', async () => {
  const sb = fakeSb();
  const orig = sb.from.bind(sb);
  sb.from = (t) => { const a = orig(t); a.single = async () => ({ data: null, error: new Error('boom') }); return a; };
  await assert.rejects(recordApplication({ sb, resolveJobId: resolve(null), userId: 'u1', now: () => NOW, body: { jobUrl: 'https://a.com/j/9', stage: 'opened' } }), /boom/);
});

test('reportOutcome sets both the boolean and the status, scoped to the user', async () => {
  const sb = fakeSb([{ id: 5, user_id: 'u1', status: 'filled' }, { id: 5, user_id: 'u2', status: 'filled' }]);
  await reportOutcome({ sb, userId: 'u1', id: 5, submitted: true, now: () => NOW });
  assert.equal(sb.state.rows[0].status, 'submitted');
  assert.equal(sb.state.rows[0].submitted, true);
  assert.equal(sb.state.rows[1].status, 'filled');
  await reportOutcome({ sb, userId: 'u1', id: 5, submitted: false, now: () => NOW });
  assert.equal(sb.state.rows[0].status, 'failed');
  assert.equal(sb.state.rows[0].submitted, false);
});
