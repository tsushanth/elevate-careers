import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedParams, encodeCursor, decodeCursor, buildFeedQuery, buildCountQuery, buildExcludedCountQuery, feedCacheKey } from './feedQuery.js';

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
