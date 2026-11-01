import { test } from 'node:test';
import assert from 'node:assert/strict';

// Regression: the reporter used to post whenever NODE_ENV=production and a key was present, with no check for a test runner,
// so a test run with those two env vars (CI, or a shell with prod env) posted fake errors to the live reporter.
test('under node --test the reporter never posts, even with NODE_ENV=production and a key set', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'sanity: running under the node test runner');
  const saved = { ...process.env };
  process.env.NODE_ENV = 'production'; process.env.FAILURE_REPORTER_KEY = 'test-key';
  delete process.env.FAILURE_REPORTER_DISABLED; delete process.env.FAILURE_REPORTER_FORCE;
  const orig = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return {}; };
  try {
    const { reportFailure, reportBackendError, reportCrash } = await import('./failureReporter.js');
    reportFailure('x', 'must not leave the process');
    reportBackendError('GET', '/x', new Error('nor this'), 500);
    await reportCrash('x', new Error('nor this either'));
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    globalThis.fetch = orig;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  assert.equal(calls, 0, 'no network call to the reporter');
});
