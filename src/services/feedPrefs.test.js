import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, activePrefs, prefClauses, resolveLocations, isDefaultList } from './feedPrefs.js';
import { buildFeedQuery, buildCountQuery, parseFeedParams } from './feedQuery.js';

const params = (q = {}) => parseFeedParams(q).params;
const clauses = (active) => { const values = []; const sql = prefClauses(active, (v) => { values.push(v); return `$${values.length}`; }); return { sql, values }; };

test('normalizePrefs: null row, empty row and junk columns yield no active preference', () => {
  assert.equal(normalizePrefs(null), null);
  assert.equal(activePrefs(normalizePrefs({}), params()), null);
  assert.equal(activePrefs(normalizePrefs({ remote: false, salary_min: 0, excluded_titles: [], excluded_locations: ['  '] }), params()), null);
  assert.equal(activePrefs(normalizePrefs({ remote: 'yes', salary_min: 'abc', excluded_titles: 'x' }), params()), null);
});

test('titles are normalised like the old list (lowercase, trim, collapse whitespace) and deduplicated', () => {
  const p = normalizePrefs({ excluded_titles: ['  Senior   Sales Rep ', 'senior sales rep', ''] });
  assert.deepEqual(p.titles, ['senior sales rep']);
  const { sql, values } = clauses(activePrefs(p, params()));
  assert.deepEqual(sql, [`lower(trim(regexp_replace(f.title, '\\s+', ' ', 'g'))) <> ALL($1::text[])`]);
  assert.deepEqual(values, [['senior sales rep']]);
});

test('soft preferences: remote and salary_min, with NULL salary kept', () => {
  const { sql, values } = clauses(activePrefs(normalizePrefs({ remote: true, salary_min: 120000 }), params()));
  assert.deepEqual(sql, ['f.remote', '(f.salary_min IS NULL OR f.salary_min >= $1)']);
  assert.deepEqual(values, [120000]);
});

test('soft preferences apply only on the default list; hard ones always', () => {
  const p = normalizePrefs({ remote: true, salary_min: 100000, excluded_titles: ['Intern'] });
  for (const q of [{ q: 'engineer' }, { remote: 'true' }, { type: 'full_time' }, { days: '7' }]) {
    const a = activePrefs(p, params(q));
    assert.equal(a.remote, false, JSON.stringify(q));
    assert.equal(a.salaryMin, null);
    assert.deepEqual(a.titles, ['intern']);
  }
  assert.equal(isDefaultList(params({ country: 'US', region: 'TX' })), true);   // a place is not a pill
  assert.equal(activePrefs(p, params({ country: 'US' })).remote, true);
});

test('prefs=off drops soft preferences but keeps hard exclusions', () => {
  const p = normalizePrefs({ remote: true, salary_min: 100000, excluded_titles: ['Intern'], excluded_locations: ['Austin'] });
  const a = activePrefs(p, params(), { off: true });
  assert.equal(a.remote, false);
  assert.equal(a.salaryMin, null);
  assert.deepEqual(a.titles, ['intern']);
  assert.ok(a.locations);
  assert.equal(activePrefs(normalizePrefs({ remote: true }), params(), { off: true }), null);
});

test('resolveLocations maps city, state, country names and codes', () => {
  const l = resolveLocations(['Austin', 'TX', 'california', 'Germany', 'de', 'United Kingdom', 'Ontario']);
  assert.ok(l.cities.includes('austin'));
  assert.deepEqual(l.countries.sort(), ['DE', 'GB'].sort());
  const pairs = l.regionCountries.map((c, i) => `${c}|${l.regionCodes[i]}`).sort();
  assert.deepEqual(pairs, ['CA|ON', 'US|CA', 'US|DE', 'US|TX']);   // 'de' is also Delaware: like the old raw-text match, a bare code hits every place it names
});

test('location exclusion removes the whole job when any of its places matches', () => {
  const { sql, values } = clauses(activePrefs(normalizePrefs({ excluded_locations: ['Austin', 'TX', 'India'] }), params()));
  assert.equal(sql.length, 2);
  assert.equal(sql[0], 'NOT (lower(f.city) = ANY($1::text[]) OR f.country_code = ANY($2::text[]))');
  assert.match(sql[1], /^NOT EXISTS \(SELECT 1 FROM job_feed g WHERE g\.job_id = f\.job_id AND \(lower\(g\.city\) = ANY\(\$1::text\[\]\) OR g\.country_code = ANY\(\$2::text\[\]\) OR EXISTS \(SELECT 1 FROM unnest\(\$3::text\[\], \$4::text\[\]\)/);
  assert.deepEqual(values, [['austin', 'tx', 'india'], ['IN'], ['US'], ['TX']]);
});

test('query builders: values stay bound and aligned, count query carries the same filters', () => {
  const ex = { dismissed: [5], excludedCompanies: ['acme'],
    prefs: activePrefs(normalizePrefs({ remote: true, salary_min: 90000, excluded_titles: ['Intern'] }), params({ country: 'US' })) };
  const feed = buildFeedQuery(params({ country: 'US' }), ex);
  const count = buildCountQuery(params({ country: 'US' }), ex);
  for (const q of [feed, count]) {
    assert.match(q.text, /f\.remote/);
    assert.match(q.text, /f\.salary_min >= \$\d+/);
    const max = Math.max(...[...q.text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    assert.equal(max, q.values.length);
    assert.ok(q.values.includes(90000));
  }
  assert.doesNotMatch(buildFeedQuery(params({ country: 'US' }), { dismissed: [], excludedCompanies: [] }).text, /salary_min >=/);
});
