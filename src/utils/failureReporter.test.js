import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderError, reportBackendError, reportFailure, instrumentAnthropic } from './failureReporter.js';
import { evaluateQueue, evaluateIngestFreshness, evaluateApplies } from '../services/monitor.js';

test('classifyProviderError: credit, auth, quota, and plain errors', () => {
  assert.equal(classifyProviderError({ status: 400, message: 'Your credit balance is too low' }), 'credit_or_quota_exhausted');
  assert.equal(classifyProviderError({ status: 401, message: 'invalid x-api-key' }), 'auth_rejected');
  assert.equal(classifyProviderError({ status: 429, message: 'rate limit quota' }), 'rate_or_quota_limited');
  assert.equal(classifyProviderError({ status: 500, message: 'boom' }), null);
  assert.equal(classifyProviderError(new Error('ETIMEDOUT')), null);
});

test('reporter is silent under NODE_ENV=test (no network)', () => {
  const orig = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return {}; };
  try {
    reportBackendError('GET', '/x', new Error('e'), 500);
    reportFailure('f', 'm', {});
    assert.equal(calls, 0);
  } finally { globalThis.fetch = orig; }
});

test('reporter posts stable payload without user content when enabled', async () => {
  const prevEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const orig = globalThis.fetch; const bodies = [];
  globalThis.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body)); return {}; };
  try {
    reportBackendError('POST', '/api/apply/enqueue', new Error('db down'), 503);
    reportBackendError('GET', '/x', new Error('client'), 404); // < 500: ignored
    reportFailure('ingest-worker', 'ingestion job failed', { provider: 'lever' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].kind, 'backend_error');
    assert.equal(bodies[0].flow, 'POST /api/apply/enqueue');
    assert.equal(bodies[1].kind, 'failure');
    assert.equal(bodies[1].message, 'ingestion job failed');
  } finally { globalThis.fetch = orig; process.env.NODE_ENV = prevEnv; }
});

test('instrumentAnthropic reports provider-wide failures once per call and rethrows', async () => {
  const prevEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const orig = globalThis.fetch; const bodies = [];
  globalThis.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body)); return {}; };
  try {
    const client = { messages: { create: async () => { const e = new Error('credit balance is too low'); e.status = 400; throw e; } } };
    instrumentAnthropic(client);
    await assert.rejects(() => client.messages.create({}), /credit balance/);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].message, 'anthropic provider failure: credit_or_quota_exhausted');
    // ordinary error: rethrown, not reported
    const c2 = { messages: { create: async () => { throw new Error('bad input'); } } };
    instrumentAnthropic(c2);
    await assert.rejects(() => c2.messages.create({}), /bad input/);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bodies.length, 1);
  } finally { globalThis.fetch = orig; process.env.NODE_ENV = prevEnv; }
});

test('evaluateQueue: stalled only when waiting, nothing active, and no recent completion', () => {
  const now = 10 * 3600_000;
  assert.deepEqual(evaluateQueue({ waiting: 3, active: 0, failed: 0, lastCompletedAt: now - 3 * 3600_000, now }), ['queue_stalled']);
  assert.deepEqual(evaluateQueue({ waiting: 3, active: 0, failed: 0, lastCompletedAt: null, now }), ['queue_stalled']);
  assert.deepEqual(evaluateQueue({ waiting: 3, active: 1, failed: 0, lastCompletedAt: null, now }), []);
  assert.deepEqual(evaluateQueue({ waiting: 0, active: 0, failed: 0, lastCompletedAt: null, now }), []);
  assert.deepEqual(evaluateQueue({ waiting: 3, active: 0, failed: 0, lastCompletedAt: now - 1000, now }), []);
  assert.deepEqual(evaluateQueue({ waiting: 6000, active: 2, failed: 300, lastCompletedAt: now, now }), ['queue_backlog', 'queue_many_failed']);
});

test('evaluateIngestFreshness', () => {
  const now = Date.now();
  assert.deepEqual(evaluateIngestFreshness({ newestUpdatedAt: new Date(now - 3600_000), now }), []);
  assert.deepEqual(evaluateIngestFreshness({ newestUpdatedAt: new Date(now - 31 * 3600_000), now }), ['ingest_stale']);
  assert.deepEqual(evaluateIngestFreshness({ newestUpdatedAt: null, now }), ['ingest_no_jobs']);
});

test('evaluateApplies', () => {
  assert.deepEqual(evaluateApplies({ stuck: 0, failedRecent: 0, finishedRecent: 0 }), []);
  assert.deepEqual(evaluateApplies({ stuck: 2, failedRecent: 0, finishedRecent: 10 }), ['apply_stuck']);
  assert.deepEqual(evaluateApplies({ stuck: 0, failedRecent: 3, finishedRecent: 5 }), ['apply_mostly_failing']);
  assert.deepEqual(evaluateApplies({ stuck: 0, failedRecent: 2, finishedRecent: 3 }), []); // too few runs to judge
});
