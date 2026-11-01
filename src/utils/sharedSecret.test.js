import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretMatches, ingestSecretOk } from './sharedSecret.js';

test('secretMatches: equal strings match; wrong, empty and non-string do not', () => {
  assert.equal(secretMatches('s3cret', 's3cret'), true);
  assert.equal(secretMatches('nope', 's3cret'), false);
  assert.equal(secretMatches('s3cret-extra', 's3cret'), false);
  assert.equal(secretMatches('', 's3cret'), false);
  assert.equal(secretMatches(undefined, 's3cret'), false);
  assert.equal(secretMatches(['s3cret'], 's3cret'), false);
});

test('secretMatches: unset or empty configured secret never matches (undefined must not equal undefined)', () => {
  assert.equal(secretMatches(undefined, undefined), false);
  assert.equal(secretMatches('', ''), false);
  assert.equal(secretMatches('x', undefined), false);
  assert.equal(secretMatches('x', ''), false);
});

test('ingestSecretOk: reads INGEST_SECRET per call and fails closed when it is unset', () => {
  const saved = process.env.INGEST_SECRET;
  try {
    delete process.env.INGEST_SECRET;
    assert.equal(ingestSecretOk(undefined), false, 'unset secret + missing body secret must NOT authorise');
    assert.equal(ingestSecretOk('anything'), false);
    process.env.INGEST_SECRET = 'ingest-secret';
    assert.equal(ingestSecretOk(undefined), false);
    assert.equal(ingestSecretOk('wrong'), false);
    assert.equal(ingestSecretOk('ingest-secret'), true);
  } finally {
    if (saved === undefined) delete process.env.INGEST_SECRET; else process.env.INGEST_SECRET = saved;
  }
});

test('regression guard: no route compares a body secret to INGEST_SECRET with !==/===', () => {
  for (const f of ['../api/server.js', '../routes/feed.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /[!=]==\s*process\.env\.INGEST_SECRET/, `${f} compares INGEST_SECRET directly`);
  }
});
