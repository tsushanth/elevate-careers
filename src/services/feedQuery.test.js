import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedParams, encodeCursor, decodeCursor, buildFeedQuery, buildCountQuery, buildExcludedCountQuery, feedCacheKey, fitRankEnabled, NEAR_SCHEME_FIT } from './feedQuery.js';

const ok = (q) => { const r = parseFeedParams(q); assert.equal(r.ok, true, JSON.stringify(r)); return r.params; };

test('defaults: worldwide, 25 per page, no cursor', () => {
  const p = ok({});
  assert.equal(p.limit, 25);
  assert.equal(p.cursor, null);
  assert.equal(p.hasPlace, false);
  assert.equal(p.plain, false);
});

test('place-only query is "plain"; any other filter is not', () => {
  assert.equal(ok({ country: 'us' }).plain, true);
  assert.equal(ok({ country: 'us' }).country, 'US');
  assert.equal(ok({ country: 'US', remote: 'true' }).plain, false);
  assert.equal(ok({ country: 'US', q: 'engineer' }).plain, false);
});

test('invalid input is rejected, not guessed', () => {
  assert.equal(parseFeedParams({ country: 'USA' }).ok, false);
  assert.equal(parseFeedParams({ country: 'US', region: 'tx!!' }).ok, false);
  assert.equal(parseFeedParams({ cursor: 'garbage' }).ok, false);
  assert.equal(parseFeedParams({ days: 'abc' }).ok, false);
});

test('limit is clamped to 1..50', () => {
  assert.equal(ok({ limit: '500' }).limit, 50);
  assert.equal(ok({ limit: '0' }).limit, 1);
});

test('cursor round-trips and rejects garbage', () => {
  const c = encodeCursor('2026-10-01T00:00:00.000Z', 42);
  assert.deepEqual(decodeCursor(c), { sortAt: '2026-10-01T00:00:00.000Z', jobId: 42, mode: 'sort_at' });
  assert.throws(() => decodeCursor('###'), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from('[1]').toString('base64url')), /invalid cursor/);
});

test('worldwide uses the is_primary rows; country uses is_country_primary; state uses is_region_primary', () => {
  assert.match(buildFeedQuery(ok({})).text, /f\.is_primary/);
  assert.match(buildFeedQuery(ok({ country: 'US' })).text, /f\.is_country_primary/);
  assert.match(buildFeedQuery(ok({ country: 'US', region: 'TX' })).text, /f\.is_region_primary/);
  const city = buildFeedQuery(ok({ country: 'US', region: 'TX', city: 'Austin' }));
  assert.match(city.text, /f\.city_key = \$/);
  assert.ok(city.values.includes('austin'));
  assert.doesNotMatch(city.text, /is_country_primary|is_region_primary/);
});

test('every filter is a bound parameter, never interpolated', () => {
  const evil = buildFeedQuery(ok({ q: "x'; DROP TABLE job;--", city: "o'brien", country: 'US', type: 'full_time' }));
  assert.doesNotMatch(evil.text, /DROP TABLE/);
  assert.doesNotMatch(evil.text, /o'brien/);
  assert.ok(evil.values.includes("x'; DROP TABLE job;--"));
});

test('ordering and keyset condition match the index (sort_at desc, job_id desc)', () => {
  const p = ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42) });
  const { text, values } = buildFeedQuery(p);
  assert.match(text, /ORDER BY f\.sort_at DESC, f\.job_id DESC/);
  assert.match(text, /\(f\.sort_at, f\.job_id\) < \(\$\d+::timestamptz, \$\d+::bigint\)/);
  assert.ok(values.includes('2026-10-01T00:00:00.000Z') && values.includes(42));
  assert.equal(values[values.length - 1], 26); // limit + 1 to detect a next page
});

test('exclusions become bound array parameters', () => {
  const { text, values } = buildFeedQuery(ok({}), { dismissed: [1, 2], excludedCompanies: ['acme'] });
  assert.match(text, /f\.job_id <> ALL\(\$\d+::bigint\[\]\)/);
  assert.match(text, /f\.company_key <> ALL\(\$\d+::text\[\]\)/);
  assert.ok(values.some(v => Array.isArray(v) && v[0] === 1));
});

test('count query is capped and has no ordering, cursor or limit+1', () => {
  const { text } = buildCountQuery(ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42) }));
  assert.match(text, /LIMIT 1001/);
  assert.doesNotMatch(text, /ORDER BY|sort_at, f\.job_id\) </);
});

test('cache key ignores parameter order and differs by filter', () => {
  assert.equal(feedCacheKey(ok({ country: 'US', remote: 'true' })), feedCacheKey(ok({ remote: 'true', country: 'US' })));
  assert.notEqual(feedCacheKey(ok({ country: 'US' })), feedCacheKey(ok({ country: 'GB' })));
});

test('cursor rejects unsafe integers, negatives, zero, and non-ISO timestamps', () => {
  assert.throws(() => decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 1e300)), /invalid cursor/);
  assert.throws(() => decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 2 ** 60)), /invalid cursor/);
  assert.throws(() => decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', -1)), /invalid cursor/);
  assert.throws(() => decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 0)), /invalid cursor/);
  assert.throws(() => decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 3.14)), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(['Oct 1 2026', 42])).toString('base64url')), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(['2026', 42])).toString('base64url')), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(['1', 42])).toString('base64url')), /invalid cursor/);
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(['2026-13-45T00:00:00.000Z', 42])).toString('base64url')), /invalid cursor/);
  const valid = encodeCursor('2026-10-01T00:00:00.000Z', 42);
  assert.deepEqual(decodeCursor(valid), { sortAt: '2026-10-01T00:00:00.000Z', jobId: 42, mode: 'sort_at' });
});

test('country ZZ (unknown location) is rejected', () => {
  assert.equal(parseFeedParams({ country: 'ZZ' }).ok, false);
});

test('limit edge cases', () => {
  assert.equal(ok({ limit: '-5' }).limit, 1);
  assert.equal(ok({ limit: 'abc' }).limit, 25);
});

test('days range validation', () => {
  assert.equal(parseFeedParams({ days: '0' }).ok, false);
  assert.equal(parseFeedParams({ days: '366' }).ok, false);
  assert.equal(parseFeedParams({ days: '1.5' }).ok, false);
  assert.equal(ok({ days: '365' }).days, 365);
  assert.equal(ok({ days: '1' }).days, 1);
});

test('employment type validation', () => {
  assert.equal(parseFeedParams({ country: 'US', type: 'Full Time!' }).ok, false);
});

test('region or city without country is rejected', () => {
  assert.equal(parseFeedParams({ region: 'TX' }).ok, false);
  assert.equal(parseFeedParams({ city: 'Austin' }).ok, false);
});

test('parameter placeholder order matches values array', () => {
  const p = ok({ q: 'engineer', days: '30', type: 'full_time', country: 'US' });
  const { text, values } = buildFeedQuery(p, { dismissed: [1, 2, 3] });
  // Extract all $n from the query text
  const placeholders = text.match(/\$\d+/g) || [];
  const maxPlaceholder = Math.max(...placeholders.map(p => parseInt(p.slice(1), 10)));
  assert.equal(maxPlaceholder, values.length, `Placeholders go up to $${maxPlaceholder} but values array has ${values.length} items`);
  // Verify no gaps: check that placeholder set is {1..values.length}
  const placeholderSet = new Set(placeholders.map(p => parseInt(p.slice(1), 10)));
  for (let i = 1; i <= values.length; i++) {
    assert.ok(placeholderSet.has(i), `Missing placeholder $${i}`);
  }
});

test('a city without a region binds the empty region (the unregioned city)', () => {
  const q = buildFeedQuery(ok({ country: 'DE', city: 'Berlin' }));
  assert.match(q.text, /f\.country_code = \$1 AND f\.city_key = \$2 AND f\.region_code = \$3/);
  assert.deepEqual(q.values.slice(0, 3), ['DE', 'berlin', '']);
  const c = buildCountQuery(ok({ country: 'DE', city: 'Berlin' }));
  assert.match(c.text, /f\.region_code = \$3/);
  assert.deepEqual(c.values.slice(0, 3), ['DE', 'berlin', '']);
});

test('a city with a region binds that region', () => {
  const q = buildFeedQuery(ok({ country: 'CA', region: 'on', city: 'Toronto' }));
  assert.match(q.text, /f\.region_code = \$3/);
  assert.deepEqual(q.values.slice(0, 3), ['CA', 'toronto', 'ON']);
});

test('city is lower-cased and trimmed so Austin and austin share one cache key', () => {
  const a = ok({ country: 'US', region: 'TX', city: ' Austin ' });
  const b = ok({ country: 'US', region: 'TX', city: 'austin' });
  assert.equal(a.city, 'austin');
  assert.equal(feedCacheKey(a), feedCacheKey(b));
});

test('absorb: region IN (region, empty) with the dedupe guard; off by default', () => {
  const p = ok({ country: 'US', region: 'ca', city: 'San Francisco' });
  const strict = buildFeedQuery(p);
  assert.match(strict.text, /f\.region_code = \$3/);
  assert.doesNotMatch(strict.text, /IN \(/);
  const q = buildFeedQuery(p, {}, { absorb: true });
  assert.match(q.text, /f\.region_code IN \(\$3, ''\)/);
  assert.match(q.text, /NOT EXISTS/);
  assert.deepEqual(q.values.slice(0, 3), ['US', 'san francisco', 'CA']);
  const c = buildCountQuery(p, {}, { absorb: true });
  assert.match(c.text, /f\.region_code IN \(\$3, ''\)/);
  // no region: absorb has no effect (bare city is the regionless city)
  const bare = buildFeedQuery(ok({ country: 'US', city: 'Austin' }), {}, { absorb: true });
  assert.doesNotMatch(bare.text, /IN \(/);
});

test('excluded-count query: no exclusions is a constant zero with no bound values', () => {
  const q = buildExcludedCountQuery(ok({ country: 'US' }), {});
  assert.equal(q.text, 'SELECT 0::int AS n');
  assert.deepEqual(q.values, []);
});

test('excluded-count query: dismissed uses the id probe only; companies only skips the NOT clause', () => {
  const p = ok({ country: 'US', region: 'tx' });
  const d = buildExcludedCountQuery(p, { dismissed: [1, 2] });
  assert.match(d.text, /f\.job_id = ANY\(\$3::bigint\[\]\)/);
  assert.doesNotMatch(d.text, /company_key/);
  assert.deepEqual(d.values, ['US', 'TX', [1, 2]]);
  const c = buildExcludedCountQuery(p, { excludedCompanies: ['acme'] });
  assert.match(c.text, /f\.company_key = ANY\(\$3::text\[\]\)/);
  assert.doesNotMatch(c.text, /NOT \(/);
});

test('excluded-count query: both lists never double count (company probe skips dismissed ids), same filter as the page', () => {
  const p = ok({ country: 'CA', region: 'on', city: 'Toronto' });
  const q = buildExcludedCountQuery(p, { dismissed: [5], excludedCompanies: ['x'] }, { absorb: true });
  assert.match(q.text, /NOT \(f\.job_id = ANY\(\$4::bigint\[\]\)\)/);
  assert.match(q.text, /f\.region_code IN \(\$3, ''\)/);
  assert.deepEqual(q.values, ['CA', 'toronto', 'ON', [5], ['x']]);
});

test('feed_at mode orders and paginates by coalesce(feed_at, sort_at); posted_at stays sort_at', () => {
  const p = ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at') });
  const { text } = buildFeedQuery(p, {}, { mode: 'feed_at' });
  assert.match(text, /ORDER BY coalesce\(f\.feed_at, f\.sort_at\) DESC, f\.job_id DESC/);
  assert.match(text, /\(coalesce\(f\.feed_at, f\.sort_at\), f\.job_id\) < \(\$\d+::timestamptz, \$\d+::bigint\)/);
  assert.match(text, /f\.sort_at AS posted_at/);
  assert.throws(() => buildFeedQuery(p, {}, { mode: 'sort_at' }), /cursor mode mismatch/);
});

test('count and excluded-count queries do not depend on the order mode', () => {
  const p = ok({ country: 'US' });
  assert.doesNotMatch(buildCountQuery(p).text, /feed_at/);
  assert.doesNotMatch(buildExcludedCountQuery(p, { dismissed: [1] }).text, /feed_at/);
});

test('cache key differs by order mode and by cursor mode', () => {
  const p = ok({ country: 'US' });
  assert.notEqual(feedCacheKey(p, 'sort_at'), feedCacheKey(p, 'feed_at'));
});

// ---- role filter ---------------------------------------------------------------------------

test('role param: validated slug, part of the cache key, never "plain"', () => {
  assert.equal(ok({ country: 'US', role: 'legal' }).role, 'legal');
  assert.equal(ok({ country: 'US', role: ' Legal ' }).role, 'legal');
  assert.equal(ok({ country: 'US' }).role, '');
  assert.equal(ok({ country: 'US', role: 'legal' }).plain, false);
  assert.deepEqual(parseFeedParams({ role: 'janitor' }), { ok: false, error: 'invalid role' });
  assert.notEqual(feedCacheKey(ok({ country: 'US', role: 'legal' })), feedCacheKey(ok({ country: 'US', role: 'sales' })));
  assert.notEqual(feedCacheKey(ok({ country: 'US', role: 'legal' })), feedCacheKey(ok({ country: 'US' })));
  // keys of role-less requests are what they were before roles existed (no cold Redis after the deploy)
  assert.ok(!feedCacheKey(ok({ country: 'US' })).includes('role'));
});

test('role in SQL: bound tsquery, opaque function for pages, gate only on the capped count', () => {
  const p = ok({ country: 'US', role: 'legal' });
  const page = buildFeedQuery(p, {}, { mode: 'feed_at' });
  assert.match(page.text, /ts_match_vq\(to_tsvector\('simple', f\.title\), \$\d+::tsquery\)/);
  assert.doesNotMatch(page.text, /to_tsvector\('simple', f\.title\) @@/);
  assert.ok(page.values.some(v => typeof v === 'string' && v.includes(`'attorney':*`)));
  const count = buildCountQuery(p);
  assert.match(count.text, /to_tsvector\('simple', f\.title\) @@ \$\d+::tsquery AND ts_match_vq/);   // legal is a gin family
  const dense = buildCountQuery(ok({ country: 'US', role: 'engineering' }));
  assert.doesNotMatch(dense.text, /to_tsvector\('simple', f\.title\) @@/);                            // engineering: scan only
  // user text never reaches the SQL text
  for (const q of [page.text, count.text, dense.text]) assert.doesNotMatch(q, /attorney|engineer/);
});

test('profile match filter is ANDed in and bound like a role', () => {
  const match = { tsquery: `'paralegal':*`, gate: `'paralegal':*`, pageGate: false };
  const page = buildFeedQuery(ok({ country: 'US' }), { match }, { mode: 'feed_at' });
  assert.match(page.text, /ts_match_vq/);
  assert.ok(page.values.includes(`'paralegal':*`));
  assert.match(buildCountQuery(ok({ country: 'US' }), { match }).text, /to_tsvector\('simple', f\.title\) @@ \$\d+::tsquery/);
  const gatedPage = buildFeedQuery(ok({ country: 'US' }), { match: { ...match, pageGate: true } }, { mode: 'feed_at' });
  assert.match(gatedPage.text, /to_tsvector\('simple', f\.title\) @@ \$\d+::tsquery AND ts_match_vq/);
});

// ---- near home first (nearHome.js) ----
test('near cursor: [tier, key, id, mode, sig] round-trips; legacy cursors stay 3-element', () => {
  const c = encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 1, sig: 'CA' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), [1, '2026-10-01T00:00:00.000Z', 42, 'f', 'CA']);
  assert.deepEqual(decodeCursor(c), { sortAt: '2026-10-01T00:00:00.000Z', jobId: 42, mode: 'feed_at', tier: 1, sig: 'CA' });
  assert.equal(decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 2, sig: 'n3:CA' })).tier, 2);
  assert.deepEqual(JSON.parse(Buffer.from(encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at'), 'base64url').toString()), ['2026-10-01T00:00:00.000Z', 42, 'f']);
  assert.equal(decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at')).tier, undefined);
  for (const bad of [[3, '2026-10-01T00:00:00.000Z', 42, 'f', 'x'], [2, 'k', 1, 'f', 'x'], [0, '2026-10-01T00:00:00.000Z', 42, 'f'], [0, '2026-10-01T00:00:00.000Z', 42, 'q', 'x'], [0, '2026-10-01T00:00:00.000Z', 42, 'f', 7]]) {
    assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(bad)).toString('base64url')), /invalid cursor/);
  }
});

test('near cache key: sorted region set joins the key; no home keeps the old key', () => {
  const p = ok({ country: 'US' });
  const plain = feedCacheKey(p, 'feed_at');
  assert.equal(feedCacheKey(p, 'feed_at', null), plain);
  const ca = feedCacheKey(p, 'feed_at', { regions: ['CA'] });
  // never equal to the key the old two-tier scheme produced for the same home
  assert.notEqual(ca, JSON.stringify([{ country: 'US', hasPlace: true, limit: 25, plain: true, q: '', region: '', city: '', remote: false, type: '', days: null }, null, 'feed_at', ['near', 'CA']]));
  assert.ok(ca.includes('"n3"') && !ca.includes('"near"'));
  const ny = feedCacheKey(p, 'feed_at', { regions: ['NY'] });
  assert.equal(new Set([plain, ca, ny]).size, 3);
  assert.equal(feedCacheKey(p, 'feed_at', { regions: ['WA', 'CA'] }), feedCacheKey(p, 'feed_at', { regions: ['CA', 'WA'] }));
  assert.notEqual(feedCacheKey(p, 'feed_at', { regions: ['CA', 'WA'] }), ca);
  // a tiered cursor never shares a key with a plain one at the same position
  const mk = (near) => ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', near || undefined) });
  assert.notEqual(feedCacheKey(mk({ tier: 0, sig: 'CA' }), 'feed_at', { regions: ['CA'] }), feedCacheKey(mk({ tier: 1, sig: 'CA' }), 'feed_at', { regions: ['CA'] }));
});

test('near query: arms follow the cursor tier, every filter rides on every arm', () => {
  const home = { regions: ['CA'] };
  const build = (q, ex = {}) => { const p = ok(q); return buildFeedQuery(p, ex, { mode: 'feed_at', near: home }); };
  const cur = (tier) => encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier, sig: 'n3:CA' });
  const keyset = /\(coalesce\(f\.feed_at, f\.sort_at\), f\.job_id\) </g;
  const first = build({ country: 'US' });
  assert.equal((first.text.match(/UNION ALL/g) || []).length, 2);              // home state + nationwide remote + rest
  assert.match(first.text, /f\.is_region_primary AND f\.region_code = h\.r/);
  assert.match(first.text, /f\.remote AND f\.region_code = ''/);
  assert.match(first.text, /f\.region_code <> ALL\(\$\d+::text\[\]\) AND NOT \(f\.remote AND f\.region_code = ''\)/);
  assert.match(first.text, /ORDER BY tier, order_key DESC, id DESC/);
  assert.ok(first.values.some(v => Array.isArray(v) && v[0] === 'CA'));
  assert.doesNotMatch(first.text, /\(coalesce\(f\.feed_at, f\.sort_at\), f\.job_id\) </);   // no cursor predicate on the first page
  const t0 = build({ country: 'US', cursor: cur(0) });
  assert.equal((t0.text.match(/UNION ALL/g) || []).length, 2);
  assert.equal((t0.text.match(keyset) || []).length, 1);                       // only the home-state arm continues; tiers 1 and 2 start from the top
  const t1 = build({ country: 'US', cursor: cur(1) });
  assert.equal((t1.text.match(/UNION ALL/g) || []).length, 1);                 // nationwide remote + rest
  assert.doesNotMatch(t1.text, /h\.r/);
  assert.equal((t1.text.match(keyset) || []).length, 1);                       // only the tier-1 arm continues
  const t2 = build({ country: 'US', cursor: cur(2) });
  assert.equal((t2.text.match(/UNION ALL/g) || []).length, 0);                 // only the rest
  assert.doesNotMatch(t2.text, /h\.r|f\.remote AND f\.region_code = ''\n/);
  assert.equal((t2.text.match(keyset) || []).length, 1);
  // role / prefs / exclusions appear in all three arms
  const withAll = build({ country: 'US', role: 'engineering' }, { dismissed: [1, 2], excludedCompanies: ['acme'], prefs: { titles: [], locations: null, remote: false, salaryMin: 100 } });
  for (const frag of ['f.job_id <> ALL(', 'f.company_key <> ALL(', 'f.salary_min IS NULL OR']) {
    assert.equal(withAll.text.split(frag).length - 1, 3, frag);
  }
  assert.equal(withAll.text.split('ts_match_vq(').length - 1, 3);   // the role title test
  // a wide home walks the country index with one arm instead of one probe per region
  const wide = buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'feed_at', near: { regions: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'] } });
  assert.doesNotMatch(wide.text, /LATERAL/);
  assert.match(wide.text, /f\.region_code = ANY\(/);
  assert.throws(() => buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'sort_at', near: home }), /feed_at/);
});

// ---- fit buckets (FEED_FIT_RANK) ----
test('fitRankEnabled: off unless explicitly on', () => {
  assert.equal(fitRankEnabled({}), false);
  assert.equal(fitRankEnabled({ FEED_FIT_RANK: 'off' }), false);
  assert.equal(fitRankEnabled({ FEED_FIT_RANK: 'maybe' }), false);
  for (const v of ['on', '1', 'true', 'ON']) assert.equal(fitRankEnabled({ FEED_FIT_RANK: v }), true);
});

test('fit cursor: sixth element carries the bucket; five-element cursors stay valid; bad buckets are rejected', () => {
  const c = encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 1, sig: 'n3f:CA', bucket: 1 });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), [1, '2026-10-01T00:00:00.000Z', 42, 'f', 'n3f:CA', 1]);
  assert.deepEqual(decodeCursor(c), { sortAt: '2026-10-01T00:00:00.000Z', jobId: 42, mode: 'feed_at', tier: 1, sig: 'n3f:CA', bucket: 1 });
  assert.equal(decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 0, sig: 'n3f:CA', bucket: 0 })).bucket, 0);
  assert.equal(decodeCursor(encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 0, sig: 'n3:CA' })).bucket, undefined);   // old scheme: no bucket
  for (const bad of [2, -1, '0', null, 0.5]) {
    assert.throws(() => decodeCursor(Buffer.from(JSON.stringify([0, '2026-10-01T00:00:00.000Z', 42, 'f', 'n3f:CA', bad])).toString('base64url')), /invalid cursor/);
  }
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify([0, '2026-10-01T00:00:00.000Z', 42, 'f', 'x', 0, 0])).toString('base64url')), /invalid cursor/);
});

test('fit cache key: own scheme tag, differs from the unbucketed key', () => {
  const p = ok({ country: 'US' });
  const plain = feedCacheKey(p, 'feed_at', { regions: ['CA'] });
  const fit = feedCacheKey(p, 'feed_at', { regions: ['CA'], fit: { strong: 'x' } });
  assert.notEqual(plain, fit);
  assert.ok(fit.includes(`"${NEAR_SCHEME_FIT}"`) && NEAR_SCHEME_FIT === 'n3f' && plain.includes('"n3"'));
  const mk = (bucket) => ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 0, sig: 'n3f:CA', bucket }) });
  assert.notEqual(feedCacheKey(mk(0), 'feed_at', { regions: ['CA'], fit: {} }), feedCacheKey(mk(1), 'feed_at', { regions: ['CA'], fit: {} }));
});

test('fit near query: tier x bucket arms, the bucket test is the same opaque ts_match_vq, ordered (tier, bucket, key, id)', () => {
  const fit = { strong: "('a')", bucket1: null };
  const home = { regions: ['CA'], fit };
  const cur = (tier, bucket) => encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier, sig: 'n3f:CA', bucket });
  const build = (q) => buildFeedQuery(ok(q), { match: { tsquery: "('a') | ('b')", gate: null, pageGate: false } }, { mode: 'feed_at', near: home });
  const arms = (b) => (b.text.match(/UNION ALL/g) || []).length + 1;
  const keyset = /\(coalesce\(f\.feed_at, f\.sort_at\), f\.job_id\) </g;
  const first = build({ country: 'US' });
  assert.equal(arms(first), 6);
  assert.match(first.text, /ORDER BY tier, bucket, order_key DESC, id DESC/);
  assert.equal((first.text.match(/ AND NOT ts_match_vq\(/g) || []).length, 3);
  assert.equal(first.values.filter(v => v === fit.strong).length, 1);          // the strong tsquery is bound once
  assert.doesNotMatch(first.text, keyset);
  // the cursor position (tier, bucket) drops the arms before it and continues only its own arm
  const at = (t, b) => build({ country: 'US', cursor: cur(t, b) });
  assert.equal(arms(at(0, 0)), 6); assert.equal((at(0, 0).text.match(keyset) || []).length, 1);
  assert.equal(arms(at(0, 1)), 5); assert.equal((at(0, 1).text.match(keyset) || []).length, 1);
  assert.equal(arms(at(1, 0)), 4); assert.doesNotMatch(at(1, 0).text, /h\.r/);
  assert.equal(arms(at(1, 1)), 3);
  assert.equal(arms(at(2, 0)), 2); assert.equal(arms(at(2, 1)), 1);
  assert.equal((at(2, 1).text.match(keyset) || []).length, 1);
  assert.match(at(2, 1).text, /NOT ts_match_vq/);
  // a fit cursor with no bucket (old scheme) cannot be applied
  assert.throws(() => buildFeedQuery(ok({ country: 'US', cursor: encodeCursor('2026-10-01T00:00:00.000Z', 42, 'feed_at', { tier: 0, sig: 'n3:CA' }) }), {}, { mode: 'feed_at', near: home }), /no fit bucket/);
  // unbucketed query is untouched: no bucket column, 3 arms
  const plain = buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'feed_at', near: { regions: ['CA'] } });
  assert.equal(arms(plain), 3); assert.doesNotMatch(plain.text, /bucket/);
});

test('fit near query: bucket 1 is pruned when provably empty, GIN-gated when sparse', () => {
  const run = (bucket1) => buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'feed_at', near: { regions: ['CA'], fit: { strong: "('a')", bucket1 } } });
  const empty = run({ empty: true });
  assert.equal((empty.text.match(/UNION ALL/g) || []).length + 1, 3);
  assert.doesNotMatch(empty.text, /NOT ts_match_vq/);
  const gated = run({ gate: "('intern')" });
  assert.equal((gated.text.match(/to_tsvector\('simple', f\.title\) @@ \$\d+::tsquery/g) || []).length, 3);   // only the three bucket-1 arms carry the gate
  assert.ok(gated.values.includes("('intern')"));
  // multi-state / wide homes keep the bucket on the single walk
  const wide = buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'feed_at', near: { regions: Array.from({ length: 9 }, (_, i) => 'A' + i), fit: { strong: "('a')", bucket1: null } } });
  assert.doesNotMatch(wide.text, /LATERAL/);
  assert.equal((wide.text.match(/UNION ALL/g) || []).length + 1, 6);
  // multi-region (<= 8) home: bucket column also on the LATERAL arms
  const multi = buildFeedQuery(ok({ country: 'US' }), {}, { mode: 'feed_at', near: { regions: ['CA', 'OR', 'WA'], fit: { strong: "('a')", bucket1: null } } });
  assert.equal((multi.text.match(/LATERAL/g) || []).length, 2);   // one lateral arm per bucket
});
