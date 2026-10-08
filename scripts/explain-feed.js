// Verifies the feed queries use the partial indexes on job_feed (no seq scan
// of job_feed) and prints timings. Read only. Needs DATABASE_URL.
// Index mapping (see feedQuery.js):
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + [region] + city -> idx_feed_city (country_code, region_code, city_key);
//     a city without a region means region_code = ''.
//   keyword            -> job.tsv (GIN index)
//   node scripts/explain-feed.js            (FEED_ORDER=sort_at, the default)
//   FEED_ORDER=feed_at node scripts/explain-feed.js   (needs the *_fa indexes, supabase/manual/20261011000300_*)
// Also fails on an explicit Sort node for non-keyword scenarios: the index must deliver the order.
import { db } from '../src/db/index.js';
import { parseFeedParams, buildFeedQuery, encodeCursor, feedOrderMode } from '../src/services/feedQuery.js';

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

let failed = false;
for (const [name, query] of Object.entries(scenarios)) {
  const parsed = parseFeedParams(query);
  if (!parsed.ok) {
    console.log(`FAIL ${name.padEnd(20)} ${parsed.error}`);
    failed = true;
    continue;
  }
  const { text, values } = buildFeedQuery(parsed.params);
  const t0 = Date.now();
  const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${text}`, values);
  const plan = rows.map(r => r['QUERY PLAN']).join('\n');
  const keyword = /keyword/.test(name);
  const seq = /Seq Scan on job_feed/.test(plan) || (!keyword && /\bSort\b/.test(plan));
  const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
  console.log(`${seq ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${exec} ms  (wall ${Date.now() - t0} ms)`);
  if (seq) { failed = true; console.log(plan); }
}
await db.close();
process.exit(failed ? 1 : 0);
