import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderOf, buildFeedRows } from './feedRows.js';

const job = (over = {}) => ({
  id: 7, title: 'Staff Engineer', company_name: 'Acme', company_logo_domain: 'acme.com', company_key: 'acme',
  provider: 'greenhouse', apply_url: 'https://boards.greenhouse.io/acme/jobs/1', employment_type: 'full_time',
  remote: false, salary_min: null, salary_max: null, salary_currency: null,
  posted_at: '2026-10-01T00:00:00Z', created_at: '2026-10-02T00:00:00Z', is_active: true, ...over,
});

test('applyProviderOf recognises supported ATS hosts and ignores others', () => {
  assert.equal(applyProviderOf('https://boards.greenhouse.io/acme/jobs/1'), 'greenhouse');
  assert.equal(applyProviderOf('https://job-boards.greenhouse.io/x'), 'greenhouse');
  assert.equal(applyProviderOf('https://jobs.lever.co/acme/abc'), 'lever');
  assert.equal(applyProviderOf('https://jobs.ashbyhq.com/acme/1'), 'ashby');
  assert.equal(applyProviderOf('https://acme.wd5.myworkdayjobs.com/en-US/x'), 'workday');
  assert.equal(applyProviderOf('https://careers.example.com/apply'), null);
  assert.equal(applyProviderOf('not a url'), null);
  assert.equal(applyProviderOf(null), null);
  // A lookalike host must not match.
  assert.equal(applyProviderOf('https://greenhouse.io.evil.example/x'), null);
});

test('one row per distinct location with the three representative flags', () => {
  const rows = buildFeedRows(job(), [
    { city: 'Austin', region: 'TX', country: 'TX' },
    { city: 'Dallas', region: 'TX', country: 'TX' },
    { city: 'Toronto', region: 'ON', country: 'CA' },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(r => r.is_primary).length, 1);
  assert.equal(rows.filter(r => r.is_country_primary).length, 2); // one US, one CA
  assert.equal(rows.filter(r => r.is_region_primary).length, 2);  // US/TX, CA/ON
  assert.deepEqual(rows.map(r => r.city_key), ['austin', 'dallas', 'toronto']);
  assert.ok(rows.every(r => r.job_id === 7 && r.region_code !== null));
});

test('sort_at falls back to created_at when posted_at is missing', () => {
  const rows = buildFeedRows(job({ posted_at: null }), [{ city: 'Austin', region: 'TX', country: 'TX' }]);
  assert.equal(new Date(rows[0].sort_at).toISOString(), '2026-10-02T00:00:00.000Z');
});

test('a job with no locations gets a single ZZ row; autofill flag follows the apply host', () => {
  const rows = buildFeedRows(job({ apply_url: 'https://careers.example.com/x' }), []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country_code, 'ZZ');
  assert.equal(rows[0].is_primary && rows[0].is_country_primary && rows[0].is_region_primary, true);
  assert.equal(rows[0].autofill_ready, false);
  assert.equal(rows[0].apply_provider, null);
  assert.equal(buildFeedRows(job(), [])[0].autofill_ready, true);
});
