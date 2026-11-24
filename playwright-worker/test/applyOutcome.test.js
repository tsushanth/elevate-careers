import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOutcome } from '../src/applyOutcome.js';

// Regression: the worker wrote status 'submitted' for every run that did not throw, including runs where no field was
// filled (login wall, no form on the page, non-form landing page). The UI shows 'submitted' as "Applied".
test('a live run that filled nothing is failed, not submitted', () => {
  const o = applyOutcome({ dryRun: false, filled: 0, fieldCount: 0 });
  assert.equal(o.status, 'failed');
  assert.match(o.error, /no form fields/i);
});

test('a live run that skipped every field is failed, with a distinct message', () => {
  const o = applyOutcome({ dryRun: false, filled: 0, fieldCount: 3 });
  assert.equal(o.status, 'failed');
  assert.match(o.error, /none could be filled/i);
});

test('a live run that filled at least one field keeps status submitted', () => {
  assert.deepEqual(applyOutcome({ dryRun: false, filled: 2, fieldCount: 5 }), { status: 'submitted', error: null });
});

test('dry runs stay preview regardless of fill count', () => {
  assert.deepEqual(applyOutcome({ dryRun: true, filled: 0, fieldCount: 0 }), { status: 'preview', error: null });
});
