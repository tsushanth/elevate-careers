// Verifies the feed queries use the partial indexes on job_feed (no seq scan
// of job_feed) and prints timings. Read only. Needs DATABASE_URL.
// Index mapping (see feedQuery.js):
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + region + city -> idx_feed_city (country_code, region_code, city_key)
//   country + city (no region) -> idx_feed_city_only (country_code, city_key)
//   keyword            -> job.tsv (GIN index)
//   node scripts/explain-feed.js
import { db } from '../src/db/index.js';
import { parseFeedParams, buildFeedQuery } from '../src/services/feedQuery.js';

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
  const seq = /Seq Scan on job_feed/.test(plan);
  const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
  console.log(`${seq ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${exec} ms  (wall ${Date.now() - t0} ms)`);
  if (seq) { failed = true; console.log(plan); }
}
await db.close();
process.exit(failed ? 1 : 0);
