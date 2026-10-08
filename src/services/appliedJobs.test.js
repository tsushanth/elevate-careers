import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppliedJobIds } from './appliedJobs.js';

const sbWith = (rows, error = null) => ({
  from: (t) => {
    assert.equal(t, 'job_applications');
    const q = { select: () => q, eq: () => q, limit: async () => ({ data: rows, error }) };
    return q;
  },
});
const dbWith = (found, seen = []) => ({ query: async (text, values) => { seen.push([text, values]); return { rows: found.map(job_id => ({ job_id })) }; } });

test('returns the resolved job ids, numbers only, de-duplicated', async () => {
  const ids = await loadAppliedJobIds({ sb: sbWith([{ job_id: 5, job_url: 'u1' }, { job_id: '5' }, { job_id: 7 }, { job_id: null, job_url: null }]), db: dbWith([]), userId: 'u' });
  assert.deepEqual(ids.sort((a, b) => a - b), [5, 7]);
});

test('rows without a job_id fall back to matching the stored apply URL in job_feed', async () => {
  const seen = [];
  const ids = await loadAppliedJobIds({ sb: sbWith([{ job_id: 5 }, { job_id: null, job_url: 'https://x/apply/1' }]), db: dbWith([9, 5], seen), userId: 'u' });
  assert.deepEqual(ids.sort((a, b) => a - b), [5, 9]);
  assert.match(seen[0][0], /job_feed/);
  assert.deepEqual(seen[0][1], [['https://x/apply/1']]);
});

test('no URL-only rows means no database lookup', async () => {
  const seen = [];
  await loadAppliedJobIds({ sb: sbWith([{ job_id: 1 }]), db: dbWith([], seen), userId: 'u' });
  assert.equal(seen.length, 0);
});

test('a lookup failure returns what is known instead of throwing', async () => {
  const bad = { query: async () => { throw new Error('boom'); } };
  const ids = await loadAppliedJobIds({ sb: sbWith([{ job_id: 3 }, { job_id: null, job_url: 'u' }]), db: bad, userId: 'u' });
  assert.deepEqual(ids, [3]);
  const ids2 = await loadAppliedJobIds({ sb: sbWith(null, { message: 'down' }), db: dbWith([]), userId: 'u' });
  assert.deepEqual(ids2, []);
});

test('caps the URL fallback at 500 urls', async () => {
  const seen = [];
  const rows = Array.from({ length: 800 }, (_, i) => ({ job_id: null, job_url: `https://x/${i}` }));
  await loadAppliedJobIds({ sb: sbWith(rows), db: dbWith([], seen), userId: 'u' });
  assert.equal(seen[0][1][0].length, 500);
});
