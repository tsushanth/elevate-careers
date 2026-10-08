// Verifies the feed queries use the partial indexes on job_feed (no seq scan
// of job_feed) and prints timings. Read only. Needs DATABASE_URL.
// Index mapping (see feedQuery.js):
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + [region] + city -> idx_feed_city (country_code, region_code, city_key);
//     a city without a region means region_code = ''.
//   keyword            -> job.tsv (GIN index)
//   role / profile     -> the title predicate to_tsvector('simple', title) @@ tsquery (GIN idx_feed_title_tsv,
//                         supabase/manual/*_job_feed_title_gin.sql) combined with the same ordered index as above.
//                         Dense (engineering), sparse (legal) and the profile match are explained for
//                         worldwide / country / state / city, first page and a deep cursor page. They must not
//                         seq-scan job_feed or add an explicit Sort; the planner may pick either the ordered
//                         feed_at index with the title test as a filter, or the GIN bitmap.
//   node scripts/explain-feed.js            (FEED_ORDER=sort_at, the default)
//   FEED_ORDER=feed_at node scripts/explain-feed.js   (needs the *_fa indexes, supabase/manual/20261011000300_*)
// Also fails on an explicit Sort node for non-keyword scenarios: the index must deliver the order.
import { db } from '../src/db/index.js';
import { parseFeedParams, buildFeedQuery, buildCountQuery, encodeCursor, feedOrderMode } from '../src/services/feedQuery.js';
import { profileFilter } from '../src/services/roleMatch.js';

const scenarios = {
  worldwide: {},
  'worldwide remote': { remote: 'true' },
  country: { country: 'US' },
  'country remote': { country: 'US', remote: 'true' },
  state: { country: 'US', region: 'TX' },
  city: { country: 'US', region: 'TX', city: 'Austin' },
  'city (no region)': { country: 'DE', city: 'Berlin' },
  keyword: { q: 'engineer' },
  'keyword + country': { country: 'US', q: 'engineer' },
};

const mode = feedOrderMode();
console.log(`FEED_ORDER=${mode}`);
// Deep-page scenarios: a keyset cursor in the active ordering.
const cur = encodeCursor('2026-09-01T00:00:00.000Z', 100000, mode);
scenarios['worldwide + cursor'] = { cursor: cur };
scenarios['country + cursor'] = { country: 'US', cursor: cur };
scenarios['city + cursor'] = { country: 'US', region: 'TX', city: 'Austin', cursor: cur };

// Role scenarios (FEED_ROLE_MATCH needs no env here: this script builds the queries directly).
// The profile is the example account: keywords Software Engineer / Full-Stack / Reinforcement Learning,
// whose phrases fall in the engineering family.
const PROFILE = profileFilter(['Software Engineer', 'Full-Stack', 'Reinforcement Learning'].map(text => ({ text })), ['engineering']);
const places = { worldwide: {}, country: { country: 'US' }, state: { country: 'US', region: 'TX' }, city: { country: 'US', region: 'TX', city: 'Austin' } };
const roleScenarios = {};   // name -> { query, match? }
for (const [pn, place] of Object.entries(places)) {
  for (const role of ['engineering', 'legal']) {
    roleScenarios[`${pn} role=${role}`] = { query: { ...place, role } };
    roleScenarios[`${pn} role=${role} +cursor`] = { query: { ...place, role, cursor: cur } };
  }
  roleScenarios[`${pn} profile`] = { query: place, match: PROFILE };
  roleScenarios[`${pn} profile +cursor`] = { query: { ...place, cursor: cur }, match: PROFILE };
}

let failed = false;
async function explain(name, query, exclusions = {}, { count = false } = {}) {
  const parsed = parseFeedParams(query);
  if (!parsed.ok) {
    console.log(`FAIL ${name.padEnd(28)} ${parsed.error}`);
    failed = true;
    return;
  }
  const { text, values } = count ? buildCountQuery(parsed.params, exclusions) : buildFeedQuery(parsed.params, exclusions);
  const t0 = Date.now();
  const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${text}`, values);
  const plan = rows.map(r => r['QUERY PLAN']).join('\n');
  const keyword = /keyword/.test(name);
  const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
  // Pages must come straight off an ordered index (no Seq Scan, no Sort). A capped count may legitimately
  // Seq Scan with an early-exit LIMIT, so it only has to stay inside the 300 ms budget.
  const seq = count ? Number(exec) > 300 : (/Seq Scan on job_feed/.test(plan) || (!keyword && /\bSort\b/.test(plan)));
  const how = /idx_feed_title_tsv/.test(plan) ? 'gin' : 'ordered-index';
  console.log(`${seq ? 'FAIL' : 'ok  '} ${name.padEnd(28)} ${String(exec).padStart(8)} ms  (wall ${Date.now() - t0} ms)${/role|profile/.test(name) ? '  ' + how : ''}`);
  if (seq) { failed = true; console.log(plan); }
}
for (const [name, query] of Object.entries(scenarios)) await explain(name, query);
for (const [name, { query, match }] of Object.entries(roleScenarios)) {
  await explain(name, query, match ? { match } : {});
  if (!/cursor/.test(name)) await explain(`${name} (count)`, query, match ? { match } : {}, { count: true });
}
await db.close();
process.exit(failed ? 1 : 0);
