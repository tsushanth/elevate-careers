// Pure: query-string parsing, the keyset cursor and the SQL builder for the
// v2 feed. Every user-supplied value is a bound parameter.
// Index selection in buildFeedQuery:
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + [region] + city -> idx_feed_city (country_code, region_code, city_key);
//     a city without a region means the unregioned city (region_code = '').
import { prefClauses } from './feedPrefs.js';

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
export function encodeCursor(sortAt, jobId, mode = 'sort_at') {
  return Buffer.from(JSON.stringify([sortAt, jobId, mode === 'feed_at' ? 'f' : 's'])).toString('base64url');
}

export function decodeCursor(s) {
  try {
    const [sortAt, jobId, m = 's'] = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    if (typeof sortAt !== 'string' || !Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('bad');
    if (new Date(sortAt).toISOString() !== sortAt) throw new Error('bad');
    if (m !== 's' && m !== 'f') throw new Error('bad');
    return { sortAt, jobId, mode: m === 'f' ? 'feed_at' : 'sort_at' };
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
  const hasPlace = !!country;
  return {
    ok: true,
    params: { country, region, city, remote, q, type, days, limit, cursor, hasPlace,
      plain: hasPlace && !remote && !q && !type && days === null },
  };
}

// A city without a region means the unregioned city (region_code = ''), the
// same key geo_place and the typeahead use; the region predicate is always bound.
function buildWhere(p, { dismissed = [], excludedCompanies = [], prefs = null }, { withCursor, absorb = false, mode = 'sort_at' }) {
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
  if (withCursor && p.cursor) {
    if (p.cursor.mode !== mode) throw new Error('cursor mode mismatch'); // feed-core answers 409 before getting here
    where.push(`(${orderExpr(mode)}, f.job_id) < (${add(p.cursor.sortAt)}::timestamptz, ${add(p.cursor.jobId)}::bigint)`);
  }
  return { where: where.join(' AND '), values, add };
}

export function buildFeedQuery(p, exclusions = {}, opts = {}) {
  const mode = opts.mode || feedOrderMode();
  const { where, values, add } = buildWhere(p, exclusions, { withCursor: true, absorb: !!opts.absorb, mode });
  const text = `
    SELECT f.job_id AS id, f.title, f.company_name, f.company_logo_domain, f.provider, f.apply_provider,
           f.autofill_ready, f.apply_url, f.city, f.region_code, f.country_code, f.remote, f.employment_type,
           f.salary_min, f.salary_max, f.salary_currency, f.sort_at AS posted_at,
           ${orderExpr(mode)} AS order_key
    FROM job_feed f
    WHERE ${where}
    ORDER BY ${orderExpr(mode)} DESC, f.job_id DESC
    LIMIT ${add(p.limit + 1)}`;
  return { text, values };
}

export function buildCountQuery(p, exclusions = {}, opts = {}) {
  const { where, values } = buildWhere(p, exclusions, { withCursor: false, absorb: !!opts.absorb });
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
// (or nextCursor) minted under the other ordering from Redis / L1.
export function feedCacheKey(p, mode = feedOrderMode()) {
  const { cursor, ...rest } = p;
  const norm = Object.keys(rest).sort().reduce((o, k) => { o[k] = rest[k]; return o; }, {});
  return JSON.stringify([norm, cursor ? [cursor.sortAt, cursor.jobId] : null, mode]);
}
