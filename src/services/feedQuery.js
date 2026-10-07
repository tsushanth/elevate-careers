// Pure: query-string parsing, the keyset cursor and the SQL builder for the
// v2 feed. Every user-supplied value is a bound parameter.
// Index selection in buildFeedQuery:
//   worldwide          -> idx_feed_primary (+ idx_feed_primary_remote if remote=true)
//   country            -> idx_feed_country (country_code, is_country_primary)
//   country + region   -> idx_feed_region (country_code, region_code, is_region_primary)
//   country + region + city -> idx_feed_city (country_code, region_code, city_key)
//   country + city (no region) -> idx_feed_city_only (country_code, city_key)
export const FEED_LIMIT_DEFAULT = 25;
export const COUNT_CAP = 1000;

export function encodeCursor(sortAt, jobId) {
  return Buffer.from(JSON.stringify([sortAt, jobId])).toString('base64url');
}

export function decodeCursor(s) {
  try {
    const [sortAt, jobId] = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    if (typeof sortAt !== 'string' || !Number.isSafeInteger(jobId) || jobId <= 0) throw new Error('bad');
    if (new Date(sortAt).toISOString() !== sortAt) throw new Error('bad');
    return { sortAt, jobId };
  } catch { throw new Error('invalid cursor'); }
}

const REGION_RE = /^[A-Za-z0-9]{1,3}$/;
const TYPE_RE = /^[a-z_]{1,30}$/;

export function parseFeedParams(query) {
  const country = String(query.country || '').toUpperCase();
  if (country && (!/^[A-Z]{2}$/.test(country) || country === 'ZZ')) return { ok: false, error: 'invalid country' };
  const region = String(query.region || '').toUpperCase();
  if (region && !REGION_RE.test(region)) return { ok: false, error: 'invalid region' };
  const city = String(query.city || '').trim().slice(0, 80);
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

function buildWhere(p, { dismissed = [], excludedCompanies = [] }, { withCursor }) {
  const values = [];
  const add = (v) => { values.push(v); return `$${values.length}`; };
  const where = ['f.is_active'];

  if (p.country) {
    where.push(`f.country_code = ${add(p.country)}`);
    if (p.city) {
      where.push(`f.city_key = ${add(p.city.toLowerCase())}`);
      if (p.region) where.push(`f.region_code = ${add(p.region)}`);
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
  if (withCursor && p.cursor) {
    where.push(`(f.sort_at, f.job_id) < (${add(p.cursor.sortAt)}::timestamptz, ${add(p.cursor.jobId)}::bigint)`);
  }
  return { where: where.join(' AND '), values, add };
}

export function buildFeedQuery(p, exclusions = {}) {
  const { where, values, add } = buildWhere(p, exclusions, { withCursor: true });
  const text = `
    SELECT f.job_id AS id, f.title, f.company_name, f.company_logo_domain, f.provider, f.apply_provider,
           f.autofill_ready, f.apply_url, f.city, f.region_code, f.country_code, f.remote, f.employment_type,
           f.salary_min, f.salary_max, f.salary_currency, f.sort_at AS posted_at
    FROM job_feed f
    WHERE ${where}
    ORDER BY f.sort_at DESC, f.job_id DESC
    LIMIT ${add(p.limit + 1)}`;
  return { text, values };
}

export function buildCountQuery(p, exclusions = {}) {
  const { where, values } = buildWhere(p, exclusions, { withCursor: false });
  return {
    text: `SELECT count(*)::int AS n FROM (SELECT 1 FROM job_feed f WHERE ${where} LIMIT ${COUNT_CAP + 1}) t`,
    values,
  };
}

export function feedCacheKey(p) {
  const { cursor, ...rest } = p;
  const norm = Object.keys(rest).sort().reduce((o, k) => { o[k] = rest[k]; return o; }, {});
  return JSON.stringify([norm, cursor ? [cursor.sortAt, cursor.jobId] : null]);
}
