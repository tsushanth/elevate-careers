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
//   near home first   -> buildNearQuery (FEED_NEAR, nearHome.js; FEED_ORDER=feed_at only), three tiers: arm A (tier 0, home
//                        state) idx_feed_region_fa per home region (LATERAL), arm B (tier 1, remote with region_code '')
//                        idx_feed_country_remote_fa (supabase/manual/20261013000100_*), arm C (tier 2, the rest)
//                        idx_feed_country_fa. Explained for the first page, deep tier 0 / 1 / 2, the 0->1 and the 1->2
//                        crossing (cursors taken from the data), single-state and multi-state (time-zone) homes,
//                        and with a dense (engineering) / sparse (legal) role.
//                        No Seq Scan on job_feed; the only Sort allowed is the outer one over the few arm rows.
//   fit buckets       -> buildNearQuery with near.fit (FEED_FIT_RANK, docs/profile-fit-ranking.md): up to 3 tiers x 2 buckets = 6 arms,
//                        explained for the example profile with and without a seniority signal, a sparse literal and a rare no-family literal.
//   node scripts/explain-feed.js            (FEED_ORDER=sort_at, the default)
//   FEED_ORDER=feed_at node scripts/explain-feed.js   (needs the *_fa indexes, supabase/manual/20261011000300_*)
// Also fails on an explicit Sort node for non-keyword scenarios: the index must deliver the order.
import { db } from '../src/db/index.js';
import { parseFeedParams, buildFeedQuery, buildCountQuery, encodeCursor, feedOrderMode } from '../src/services/feedQuery.js';
import { TZ_ZONES, homeSig } from '../src/services/nearHome.js';
import { profileFilter, fitFilter } from '../src/services/roleMatch.js';

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
async function explain(name, query, exclusions = {}, { count = false, near = null, gated = false } = {}) {
  const parsed = parseFeedParams(query);
  if (!parsed.ok) {
    console.log(`FAIL ${name.padEnd(28)} ${parsed.error}`);
    failed = true;
    return;
  }
  const { text, values } = count ? buildCountQuery(parsed.params, exclusions) : buildFeedQuery(parsed.params, exclusions, near ? { near } : {});
  const t0 = Date.now();
  const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${text}`, values);
  const plan = rows.map(r => r['QUERY PLAN']).join('\n');
  const keyword = /keyword/.test(name);
  const exec = (plan.match(/Execution Time: ([\d.]+) ms/) || [])[1];
  // Pages must come straight off an ordered index (no Seq Scan, no Sort). A capped count may legitimately
  // Seq Scan with an early-exit LIMIT, so it only has to stay inside the 300 ms budget.
  // Near-home pages carry exactly one Sort: the outer (tier, key, id) sort over the arms' few rows.
  const sorts = (plan.match(/Sort Key: .*/g) || []);
  // A gated profile (rare literal, no family) may legitimately take the GIN bitmap with a top-N sort of the few hits per arm.
  const badSort = near ? sorts.some(k => !/^Sort Key: \((\d)\)|^Sort Key: u\.tier|^Sort Key: tier/.test(k)) && !(gated && /idx_feed_title_tsv/.test(plan)) : (!keyword && /\bSort\b/.test(plan));
  const seq = count ? Number(exec) > 300 : (/Seq Scan on job_feed/.test(plan) || badSort || (near && Number(exec) > 150));
  const how = /idx_feed_title_tsv/.test(plan) ? 'gin' : 'ordered-index';
  console.log(`${seq ? 'FAIL' : 'ok  '} ${name.padEnd(28)} ${String(exec).padStart(8)} ms  (wall ${Date.now() - t0} ms)${/role|profile/.test(name) ? '  ' + how : ''}`);
  if (seq) { failed = true; console.log(plan); }
}
for (const [name, query] of Object.entries(scenarios)) await explain(name, query);
for (const [name, { query, match }] of Object.entries(roleScenarios)) {
  await explain(name, query, match ? { match } : {});
  if (!/cursor/.test(name)) await explain(`${name} (count)`, query, match ? { match } : {}, { count: true });
}

// ---- near home first (only meaningful with FEED_ORDER=feed_at) ----
// Three tiers (docs/near-home-feed.md): 0 = region_code in the home(s), 1 = remote with region_code '', 2 = the rest.
// Every cursor is taken from the data (not timed) so each scenario really sits where its name says.
if (mode === 'feed_at') {
  const SIG = homeSig(['x']);
  const homes = { 'home CA': ['CA'], 'home TX': ['TX'], 'home Pacific (tz)': TZ_ZONES['America/Los_Angeles'].regions, 'home Eastern (tz)': TZ_ZONES['America/New_York'].regions };
  const EXPR = 'coalesce(f.feed_at, f.sort_at)';
  const TIER = {   // tier -> SQL condition on the country-primary US scope; $1 = the home regions
    0: 'f.region_code = ANY($1::text[])',
    1: "f.remote AND f.region_code = ''",
    2: "f.region_code <> ALL($1::text[]) AND NOT (f.remote AND f.region_code = '')",
  };
  // The row `skip` rows into `tier` (ordered newest first, or `skip` rows from the END with last=true).
  const cursorAt = async (tier, regions, skip, last = false) => {
    const { rows: [r] } = await db.query(
      `SELECT ${EXPR} AS k, f.job_id AS id FROM job_feed f
        WHERE f.is_active AND f.is_country_primary AND f.country_code = 'US' AND ${TIER[tier]}
        ORDER BY ${EXPR} ${last ? 'ASC' : 'DESC'}, f.job_id ${last ? 'ASC' : 'DESC'} OFFSET ${skip} LIMIT 1`, TIER[tier].includes('$1') ? [regions] : []);
    return r ? encodeCursor(new Date(r.k).toISOString(), Number(r.id), mode, { tier, sig: SIG }) : null;
  };
  for (const [hn, regions] of Object.entries(homes)) {
    const cursors = {
      first: null,
      'tier0 deep': await cursorAt(0, regions, 1000),
      'tier0->tier1 crossing': await cursorAt(0, regions, 9, true),     // ten tier-0 rows are left: the page ends in tier 1
      'tier1 deep': await cursorAt(1, regions, 2000),
      'tier1->tier2 crossing': await cursorAt(1, regions, 9, true),     // ten tier-1 rows are left: the page ends in tier 2
      'tier2 deep': await cursorAt(2, regions, 20000),
    };
    for (const role of ['', 'engineering', 'legal']) {
      for (const [cn, cursor] of Object.entries(cursors)) {
        if (cn !== 'first' && !cursor) { console.log(`skip ${hn} ${cn}: not enough rows in that tier`); continue; }
        await explain(`near ${hn} ${role ? 'role=' + role + ' ' : ''}${cn}`, { country: 'US', ...(role ? { role } : {}), ...(cursor ? { cursor } : {}) }, {}, { near: { regions } });
      }
    }
  }
}

// ---- fit buckets inside the near tiers (FEED_FIT_RANK; docs/profile-fit-ranking.md) ----
// Up to 3 tiers x 2 buckets = 6 ordered arms per page. Same budget as above (< 150 ms DB time, no Seq Scan on job_feed,
// only the outer Sort). Two profiles: the example account WITH a seniority signal (level rule on) and the same keywords
// without one (level rule off). Cursors are taken from the data, so each scenario sits where its name says:
//   bucket0 deep            inside the strong bucket of tier 0
//   bucket0->1 crossing     ten strong rows are left in tier 0: the page ends in tier 0's broader bucket
//   tier0->1 crossing       ten broader rows are left in tier 0: the page ends in tier 1's strong bucket
//   tier1->2 crossing       ten broader rows are left in tier 1: the page ends in tier 2's strong bucket
//   tier2 bucket0/1 deep    deep in tier 2
if (mode === 'feed_at') {
  const KW = ['Software Engineer', 'Full-Stack', 'Reinforcement Learning'];
  // fams = the families the phrases fall in (resolveFamilies); the last two are the sparse stress cases: a rare literal
  // inside the dense engineering family (bucket 0 nearly empty), and a rare literal with no family (page query gated by GIN).
  const profiles = {
    'profile+seniority': { keywords: KW, preferredTitles: ['Senior Machine Learning Engineer', 'Staff Software Engineer, Time and Scheduling', 'Team Lead, Software Engineering'], fams: ['engineering'] },
    'profile no-seniority': { keywords: KW, preferredTitles: [], fams: ['engineering'] },
    'sparse literal (RL)': { keywords: ['Reinforcement Learning'], preferredTitles: ['Senior Machine Learning Engineer'], fams: ['engineering'] },
    'rare literal no family': { keywords: ['Paralegal'], preferredTitles: [], fams: [] },
  };
  const homes = { 'home CA': ['CA'], 'home TX': ['TX'], 'tz Pacific': TZ_ZONES['America/Los_Angeles'].regions };
  const EXPR = 'coalesce(f.feed_at, f.sort_at)';
  const TIER = { 0: 'f.region_code = ANY($1::text[])', 1: "f.remote AND f.region_code = ''", 2: "f.region_code <> ALL($1::text[]) AND NOT (f.remote AND f.region_code = '')" };
  const SIGF = homeSig(['x'], true);
  for (const [pn, prof] of Object.entries(profiles)) {
    const phrases = prof.keywords.map(text => ({ text }));
    const match = profileFilter(phrases, prof.fams);
    const fit = fitFilter(phrases, prof, prof.fams);
    for (const [hn, regions] of Object.entries(homes)) {
      // the row `skip` rows into (tier, bucket) of the profile list, or `skip` rows from its end with last=true
      const cursorAt = async (tier, bucket, skip, last = false) => {
        const dir = last ? 'ASC' : 'DESC';
        const { rows: [r] } = await db.query(
          `SELECT ${EXPR} AS k, f.job_id AS id FROM job_feed f
            WHERE f.is_active AND f.is_country_primary AND f.country_code = 'US' AND ${TIER[tier]} AND cardinality($1::text[]) >= 0
              AND ts_match_vq(to_tsvector('simple', f.title), $2::tsquery)
              AND ${bucket === 0 ? '' : 'NOT '}ts_match_vq(to_tsvector('simple', f.title), $3::tsquery)
            ORDER BY ${EXPR} ${dir}, f.job_id ${dir} OFFSET ${skip} LIMIT 1`, [regions, match.tsquery, fit.strong]);
        return r ? encodeCursor(new Date(r.k).toISOString(), Number(r.id), mode, { tier, sig: SIGF, bucket }) : null;
      };
      const cursors = {
        first: null,
        'tier0 bucket0 deep': await cursorAt(0, 0, 300),
        'tier0 bucket0->1 crossing': await cursorAt(0, 0, 9, true),
        'tier0->1 crossing': await cursorAt(0, 1, 9, true),
        'tier1->2 crossing': await cursorAt(1, 1, 9, true),
        'tier2 bucket0 deep': await cursorAt(2, 0, 1500),
        'tier2 bucket1 deep': await cursorAt(2, 1, 3000),
      };
      for (const [cn, cursor] of Object.entries(cursors)) {
        if (cn !== 'first' && !cursor) { console.log(`skip fit ${pn} ${hn} ${cn}: not enough rows there`); continue; }
        await explain(`fit ${pn} ${hn} ${cn}`, { country: 'US', ...(cursor ? { cursor } : {}) }, { match }, { near: { regions, fit: { strong: fit.strong, bucket1: fit.bucket1 } }, gated: prof.fams.length === 0 });
      }
    }
  }
}
await db.close();
process.exit(failed ? 1 : 0);
