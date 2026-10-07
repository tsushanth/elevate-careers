import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('backfill validates numeric args before connecting to database', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--batch=abc'], {
    cwd: '/Users/sushanthtiruvaipati/Documents/elevate-careers-feed',
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
  const output = result.stdout.toString() + result.stderr.toString();
  assert.match(output, /batch|numeric|invalid|NaN/i, 'output should mention batch validation');
});

test('backfill rejects negative values', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--from=-1'], {
    cwd: '/Users/sushanthtiruvaipati/Documents/elevate-careers-feed',
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
});

test('backfill rejects batch < 1', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--batch=0'], {
    cwd: '/Users/sushanthtiruvaipati/Documents/elevate-careers-feed',
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
});
