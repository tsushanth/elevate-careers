import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrack, OPEN_ONLY_STATUSES } from './applicationTracking.js';

const url = 'https://jobs.lever.co/acme/1';

test('the body a shipped extension sends is an extension run', () => {
  const body = { jobUrl: url, fieldCount: 12, aiUsed: true, filled: 9, skipped: 2, errors: 1 };
  assert.deepEqual(classifyTrack(body, 'https://jobs.lever.co'), { source: 'extension', status: 'submitted' });
});

test('an extension run that filled nothing is an attempt, not an application', () => {
  assert.deepEqual(classifyTrack({ jobUrl: url, fieldCount: 5, filled: 0, skipped: 5, errors: 0 }, ''), { source: 'extension', status: 'attempted' });
  assert.deepEqual(classifyTrack({ jobUrl: url, fieldCount: 0, filled: 0 }, ''), { source: 'extension', status: 'attempted' });
});

test('a website link opened without the extension is only opened', () => {
  assert.deepEqual(classifyTrack({ jobUrl: url, opened: true }, 'https://www.simplyappl.ai'), { source: 'web', status: 'opened' });
});

test('older website bundles and the phone app keep the old status', () => {
  assert.deepEqual(classifyTrack({ jobUrl: url, jobTitle: 't' }, 'https://www.simplyappl.ai'), { source: 'web', status: 'submitted' });
  assert.deepEqual(classifyTrack({ jobUrl: url }, 'https://simplyappl.ai'), { source: 'web', status: 'submitted' });
  assert.deepEqual(classifyTrack({ jobUrl: url, jobTitle: 't', company: 'c' }, undefined), { source: 'app', status: 'submitted' });
  assert.deepEqual(classifyTrack({ jobUrl: url, opened: 'yes' }, 'https://evil.simplyappl.ai.example'), { source: 'app', status: 'submitted' });
});

test('only opened and attempted rows leave the job in the lists', () => {
  assert.deepEqual(OPEN_ONLY_STATUSES, ['opened', 'attempted']);
});
