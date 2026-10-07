import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('backfill validates numeric args before connecting to database', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--batch=abc'], {
    cwd: repoRoot,
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
  const output = result.stdout.toString() + result.stderr.toString();
  assert.match(output, /batch|numeric|invalid|NaN/i, 'output should mention batch validation');
});

test('backfill rejects negative values', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--from=-1'], {
    cwd: repoRoot,
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
});

test('backfill rejects batch < 1', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--batch=0'], {
    cwd: repoRoot,
    timeout: 5000
  });
  assert.equal(result.status, 2, `expected exit 2 but got ${result.status}`);
});

test('backfill reads only active jobs', () => {
  const src = readFileSync(new URL('./backfill-job-feed.js', import.meta.url), 'utf8');
  assert.match(src, /WHERE id > \$1 AND is_active ORDER BY id LIMIT \$2/);
});

test('backfill failure prints the error message and the resume hint, exits 1', () => {
  const result = spawnSync(process.execPath, ['scripts/backfill-job-feed.js', '--from=7'], {
    cwd: repoRoot,
    timeout: 20000,
    env: { ...process.env, DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:1/postgres', LOG_LEVEL: 'silent' },
  });
  assert.equal(result.status, 1);
  const err = result.stderr.toString();
  assert.match(err, /backfill failed: .*ECONNREFUSED/);
  assert.match(err, /resume with --from=7/);
});
