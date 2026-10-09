// Pure: query-string parsing, the keyset cursor and the SQL builder for the
// v2 feed. Every user-supplied value is a bound parameter.
// Index selection in buildFeedQuery:
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + [region] + city -> idx_feed_city (country_code, region_code, city_key);
//     a city without a region means the unregioned city (region_code = '').
//   role / profile match -> an extra title predicate  to_tsvector('simple', f.title) @@ $n::tsquery
//     (roleMatch.js), served by the GIN index idx_feed_title_tsv (supabase/manual/*_job_feed_title_gin.sql).
//   country list with a home (FEED_NEAR, nearHome.js) -> buildNearQuery: home-state arm idx_feed_region_fa, nationwide-remote
//     arm idx_feed_country_remote_fa, rest idx_feed_country_fa (docs/near-home-feed.md).
import { prefClauses } from './feedPrefs.js';
import { isRoleSlug, roleFilter, TITLE_TSV, titleMatches } from './roleMatch.js';

export const FEED_LIMIT_DEFAULT = 25;
export const COUNT_CAP = 1000;
// Largest per-user exclusion list (dismissed ids + excluded companies) for which
// the signed-in count is made exact by subtraction; beyond it the capped count is used.
export const EXACT_EXCLUSION_MAX = 5000;

// Ordering modes. 'sort_at' orders by the job's posted time (the original feed);
// 'feed_at' orders by the company-diversity time (sort_at minus a per-company
// penalty, see supabase/migrations/20261011000000_job_feed_company_rank.sql).
// FEED_ORDER=feed_at selects the latter; anything else is sort_at (the safe default
// and the rollback). Read per call so tests and a process restart both honour it.
export function feedOrderMode(env = process.env) {
  return env.FEED_ORDER === 'feed_at' ? 'feed_at' : 'sort_at';
}
// coalesce: a row whose feed_at is still NULL (not yet recomputed, or written by
// old code during a rolling deploy) orders by its sort_at instead of sorting first.
// The feed_at indexes (supabase/manual/20261011000300_*) are built on this exact expression.
const FEED_AT_EXPR = 'coalesce(f.feed_at, f.sort_at)';
const orderExpr = (mode) => (mode === 'feed_at' ? FEED_AT_EXPR : 'f.sort_at');

// The cursor carries the ordering key of the last row ('sortAt' holds that key
// under whichever mode minted it) and the mode ('s' | 'f'), so a cursor minted under
// one ordering is never applied to the other. A legacy 2-element cursor is mode 's'.
// A "near home" page (nearHome.js) mints [tier, key, id, mode, sig]: tier 0 | 1 | 2 of the last row and
// the signature of the home region set (versioned: NEAR_SCHEME, so a cursor minted under the old
// two-tier scheme never matches), so it only continues the same tiered list (feed-core answers 409 otherwise). Everything else keeps the 3-element shape.
// Version of the near-home tier scheme. It prefixes the cursor signature (nearHome.homeSig) and the cache
// key, so cursors and cached pages of an older scheme (n2 = two tiers, unprefixed) can never be continued
// or served by this one. Bump it whenever the meaning of a tier changes.
export const NEAR_SCHEME = 'n3';

export function encodeCursor(sortAt, jobId, mode = 'sort_at', near = null) {
  const m = mode === 'feed_at' ? 'f' : 's';
  return Buffer.from(JSON.stringify(near ? [near.tier, sortAt, jobId, m, near.sig] : [sortAt, jobId, m])).toString('base64url');
}

export function decodeCursor(s) {
  try {
    let arr = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    let tier = null, sig = '';
    if (Array.isArray(arr) && (arr[0] === 0 || arr[0] === 1 || arr[0] === 2)) {
      if (arr.length !== 5 || typeof arr[4] !== 'string' || arr[4].length > 200) throw new Error('bad');
      tier = arr[0]; sig = arr[4]; arr = arr.slice(1, 4);
    }
    const [sortAt, jobId, m = 's'] = arr;
    if (typeof sortAt !== 'string' || !Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('bad');
    if (new Date(sortAt).toISOString() !== sortAt) throw new Error('bad');
    if (m !== 's' && m !== 'f') throw new Error('bad');
    const base = { sortAt, jobId, mode: m === 'f' ? 'feed_at' : 'sort_at' };
    return tier === null ? base : { ...base, tier, sig };   // tier / sig only on a near-home cursor
  } catch { throw new Error('invalid cursor'); }
}

const REGION_RE = /^[A-Za-z0-9]{1,3}$/;
const TYPE_RE = /^[a-z_]{1,30}$/;

export function parseFeedParams(query) {
  const country = String(query.country || '').toUpperCase();
  if (country && (!/^[A-Z]{2}$/.test(country) || country === 'ZZ')) return { ok: false, error: 'invalid country' };
  const region = String(query.region || '').toUpperCase();
  if (region && !REGION_RE.test(region)) return { ok: false, error: 'invalid region' };
  const city = String(query.city || '').trim().slice(0, 80).toLowerCase();
  const q = String(query.q || '').trim().slice(0, 100);
  const type = String(query.type || '');
  if (type && !TYPE_RE.test(type)) return { ok: false, error: 'invalid type' };
  let days = null;
  if (query.days !== undefined && query.days !== '') {
    days = Number(query.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: 'invalid days' };
  }
  const remote = query.remote === 'true' || query.remote === '1';
  const requested = parseInt(query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(50, Math.max(1, requested)) : FEED_LIMIT_DEFAULT;
  let cursor = null;
  if (query.cursor) {
    try { cursor = decodeCursor(query.cursor); } catch { return { ok: false, error: 'invalid cursor' }; }
  }
  if ((region || city) && !country) return { ok: false, error: 'region and city need a country' };
  const role = String(query.role || '').trim().toLowerCase();
  if (role && !isRoleSlug(role)) return { ok: false, error: 'invalid role' };
  const hasPlace = !!country;
  return {
    ok: true,
    params: { country, region, city, remote, q, type, days, limit, cursor, hasPlace, role,
      plain: hasPlace && !remote && !q && !type && days === null && !role },
  };
}

// One title filter ({ tsquery, gate, pageGate } from roleMatch.js). The exact test is always titleMatches()
// (ts_match_vq: opaque to the planner, so pages walk the ordered feed_at index and stop after 25 hits). When
// there is a gate and this query is the capped count (or the filter says the page needs it too), the gate is
// ANDed on the indexed expression so GIN can find the hits without scanning the index.
function titleClauses(f, add, forCount) {
  const exact = titleMatches(add(f.tsquery));
  return f.gate && (forCount || f.pageGate) ? [`${TITLE_TSV} @@ ${add(f.gate)}::tsquery`, exact] : [exact];
}

// A city without a region means the unregioned city (region_code = ''), the
// same key geo_place and the typeahead use; the region predicate is always bound.
function buildWhere(p, { dismissed = [], excludedCompanies = [], prefs = null, match = null }, { withCursor, absorb = false, mode = 'sort_at', forCount = false }) {
  const values = [];
  const add = (v) => { values.push(v); return `$${values.length}`; };
  const where = ['f.is_active'];

  if (p.country) {
    where.push(`f.country_code = ${add(p.country)}`);
    if (p.city) {
      where.push(`f.city_key = ${add(p.city.toLowerCase())}`);
      if (absorb && p.region) {
        // The regioned entry is dominant for this city (geo_place.absorbs_regionless):
        // include the city's regionless rows. Two idx_feed_city probes. A job with
        // both a regionless and a regioned row for the city is returned once.
        const r = add(p.region);
        where.push(`f.region_code IN (${r}, '')`,
          `(f.region_code <> '' OR NOT EXISTS (SELECT 1 FROM job_feed g WHERE g.job_id = f.job_id AND g.country_code = f.country_code AND g.region_code = ${r} AND g.city_key = f.city_key))`);
      } else {
        where.push(`f.region_code = ${add(p.region || '')}`);
      }
    } else if (p.region) {
      where.push(`f.region_code = ${add(p.region)}`, 'f.is_region_primary');
    } else {
      where.push('f.is_country_primary');
    }
  } else {
    where.push('f.is_primary');
  }
  if (p.remote) where.push('f.remote');
  if (p.type) where.push(`f.employment_type = ${add(p.type)}`);
  if (p.days !== null) where.push(`f.sort_at >= now() - make_interval(days => ${add(p.days)}::int)`);
  if (p.q) where.push(`f.job_id IN (SELECT id FROM job WHERE tsv @@ plainto_tsquery('english', ${add(p.q)}))`);
  if (dismissed.length) where.push(`f.job_id <> ALL(${add(dismissed)}::bigint[])`);
  if (excludedCompanies.length) where.push(`f.company_key <> ALL(${add(excludedCompanies)}::text[])`);
  where.push(...prefClauses(prefs, add));   // saved preferences, already resolved for this request (feedPrefs.js)
  // Job-function filter: an explicit role family, or the signed-in profile match (a tsquery text, roleMatch.js).
  if (p.role) where.push(...titleClauses(roleFilter(p.role), add, forCount));
  if (match) where.push(...titleClauses(match, add, forCount));
  if (withCursor && p.cursor) {
    if (p.cursor.mode !== mode) throw new Error('cursor mode mismatch'); // feed-core answers 409 before getting here
    where.push(`(${orderExpr(mode)}, f.job_id) < (${add(p.cursor.sortAt)}::timestamptz, ${add(p.cursor.jobId)}::bigint)`);
  }
  return { where: where.join(' AND '), values, add };
}

const FEED_COLS = `f.job_id AS id, f.title, f.company_name, f.company_logo_domain, f.provider, f.apply_provider,
           f.autofill_ready, f.apply_url, f.city, f.region_code, f.country_code, f.remote, f.employment_type,
           f.salary_min, f.salary_max, f.salary_currency, f.sort_at AS posted_at`;

export function buildFeedQuery(p, exclusions = {}, opts = {}) {
  const mode = opts.mode || feedOrderMode();
  if (opts.near) return buildNearQuery(p, exclusions, opts.near, mode, opts);
  const { where, values, add } = buildWhere(p, exclusions, { withCursor: true, absorb: !!opts.absorb, mode });
  const text = `
    SELECT ${FEED_COLS},
           ${orderExpr(mode)} AS order_key
    FROM job_feed f
    WHERE ${where}
    ORDER BY ${orderExpr(mode)} DESC, f.job_id DESC
    LIMIT ${add(p.limit + 1)}`;
  return { text, values };
}

// "Near home first" page (nearHome.js): THREE tiers inside the country-level list, same filters on all of them.
// Workplace type is separate from geography (as on LinkedIn): a remote job carries a location tag, a state or
// nothing (= the whole country).
//   tier 0  region_code in the home region(s)       on-site, hybrid AND remote jobs tagged with that state
//   tier 1  remote AND region_code = ''             remote, open to the whole country
//   tier 2  everything else                         other states (remote or not), unknown-state on-site jobs
// The three arms partition the country scope (no row twice, none lost). region_code and remote are NOT NULL
// (migration 20261008000000), so the negations below need no NULL handling:
//   A  region_code = home                                  one LATERAL probe per home region on idx_feed_region_fa
//   B  remote AND region_code = ''                         ordered walk of idx_feed_country_remote_fa, region test as filter
//   C  region_code <> ALL(homes) AND NOT (remote AND region_code = '')    ordered walk of idx_feed_country_fa
// Each arm is ordered and LIMITed on its own, the outer query only sorts the few surviving rows by
// (tier, key, id) and cuts the page. The keyset cursor carries the tier: a tier-0 cursor continues A, B and C
// (B, C from the top), a tier-1 cursor B and C (C from the top), a tier-2 cursor only C. Only meaningful for
// FEED_ORDER=feed_at (the indexes are built on coalesce(feed_at, sort_at)); feed-core never asks otherwise.
const WIDE_HOME = 8;   // more home regions than this: walk the country index instead of probing each region
function buildNearQuery(p, exclusions, near, mode, opts) {
  if (mode !== 'feed_at') throw new Error('near-home ordering needs FEED_ORDER=feed_at');
  const { where, values, add } = buildWhere(p, exclusions, { withCursor: false, absorb: !!opts.absorb, mode });
  const homes = `${add(near.regions)}::text[]`;
  const limit = add(p.limit + 1);
  const expr = orderExpr(mode);
  const after = (c) => (c ? ` AND (${expr}, f.job_id) < (${add(c.sortAt)}::timestamptz, ${add(c.jobId)}::bigint)` : '');
  const c = p.cursor;
  const cur = (t) => (c && c.tier === t ? c : null);
  const arm = (tier, cond, cursor) => `SELECT ${tier}::int AS tier, ${FEED_COLS}, ${expr} AS order_key
        FROM job_feed f WHERE ${where} AND ${cond}${after(cursor)}
        ORDER BY ${expr} DESC, f.job_id DESC LIMIT ${limit}`;
  const arms = [];
  if (!c || c.tier === 0) {
    if (near.regions.length > WIDE_HOME) {
      // A wide home (a time-zone fallback such as Eastern, ~45% of the rows): one ordered walk of the country
      // index with the region test as a filter finds hits quickly and beats 20+ per-region probes.
      arms.push(arm(0, `f.region_code = ANY(${homes})`, cur(0)));
    } else {
      arms.push(`SELECT 0::int AS tier, x.id, x.title, x.company_name, x.company_logo_domain, x.provider, x.apply_provider,
        x.autofill_ready, x.apply_url, x.city, x.region_code, x.country_code, x.remote, x.employment_type,
        x.salary_min, x.salary_max, x.salary_currency, x.posted_at, x.order_key
      FROM unnest(${homes}) AS h(r)
      CROSS JOIN LATERAL (SELECT ${FEED_COLS}, ${expr} AS order_key
        FROM job_feed f WHERE ${where} AND f.is_region_primary AND f.region_code = h.r${after(cur(0))}
        ORDER BY ${expr} DESC, f.job_id DESC LIMIT ${limit}) x`);
    }
  }
  if (!c || c.tier <= 1) {
    // A home region is never '' (nearHome only yields real region codes), so tier 1 and tier 0 cannot overlap.
    arms.push(arm(1, `f.remote AND f.region_code = ''`, cur(1)));
  }
  arms.push(arm(2, `f.region_code <> ALL(${homes}) AND NOT (f.remote AND f.region_code = '')`, cur(2)));
  const text = `
    SELECT * FROM (
      ${arms.map(a => `(${a})`).join('\n      UNION ALL\n      ')}
    ) u
    ORDER BY tier, order_key DESC, id DESC
    LIMIT ${limit}`;
  return { text, values };
}

export function buildCountQuery(p, exclusions = {}, opts = {}) {
  const { where, values } = buildWhere(p, exclusions, { withCursor: false, absorb: !!opts.absorb, forCount: true });
  return {
    text: `SELECT count(*)::int AS n FROM (SELECT 1 FROM job_feed f WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`,
    values,
  };
}

// How many rows of this filter the user's exclusions remove. Two probes that
// cannot overlap: dismissed ids (job_feed primary key) plus rows of excluded
// companies whose job is not already dismissed. Together with the unfiltered
// count this gives the exact signed-in count: base - excluded.
export function buildExcludedCountQuery(p, { dismissed = [], excludedCompanies = [] }, opts = {}) {
  if (!dismissed.length && !excludedCompanies.length) return { text: 'SELECT 0::int AS n', values: [] };
  const { where, values, add } = buildWhere(p, {}, { withCursor: false, absorb: !!opts.absorb });
  const d = dismissed.length ? add(dismissed) : null;
  const c = excludedCompanies.length ? add(excludedCompanies) : null;
  const parts = [];
  if (d) parts.push(`(SELECT count(*) FROM job_feed f WHERE ${where} AND f.job_id = ANY(${d}::bigint[]))`);
  if (c) parts.push(`(SELECT count(*) FROM job_feed f WHERE ${where} AND f.company_key = ANY(${c}::text[])${d ? ` AND NOT (f.job_id = ANY(${d}::bigint[]))` : ''})`);
  return { text: `SELECT (${parts.join(' + ')})::int AS n`, values };
}

// The order mode is part of the key so flipping FEED_ORDER never serves a page
// (or nextCursor) minted under the other ordering from Redis / L1. `home` ({ regions }) is the near-home
// tiering (nearHome.js): the sorted region set joins the key, so pages for different homes never mix
// and keys of requests without a home stay exactly what they were.
export function feedCacheKey(p, mode = feedOrderMode(), home = null) {
  const { cursor, ...rest } = p;
  if (!rest.role) delete rest.role;   // keys of role-less requests stay what they were before roles existed
  const norm = Object.keys(rest).sort().reduce((o, k) => { o[k] = rest[k]; return o; }, {});
  const cur = cursor ? (cursor.tier == null ? [cursor.sortAt, cursor.jobId] : [cursor.sortAt, cursor.jobId, cursor.tier]) : null;
  const key = [norm, cur, mode];
  if (home) key.push([NEAR_SCHEME, [...home.regions].sort().join(',')]);
  return JSON.stringify(key);
}
