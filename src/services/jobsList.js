// src/services/jobsList.js
// Query builder, cache key and warmer for the public GET /jobs listing.
//
// Why this exists (2026-11-01 incident): the old handler selected j.* for EVERY
// active job (about 98,000 rows), LEFT JOINed job_location, GROUP BY'd the lot,
// and only then applied ORDER BY posted_at LIMIT 20. A cache miss cost 8 to 14 s of
// database time (external-merge sorts spilling ~130 MB to disk, plus ~58,000
// random heap page reads), longer than the Android client's patience, and every
// minute the 60 s in-process cache expired a request paid that price again.
//
// Now the page of ids is chosen first (ORDER BY posted_at DESC NULLS LAST, id DESC
// LIMIT n, which the partial index idx_job_active_posted_at in
// supabase/manual/20261101000100_job_active_posted_at_index.sql serves straight
// from the index), and only those <= 200 rows are joined to company and
// job_location. The result set and ordering are unchanged apart from a
// deterministic id tiebreak.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const intOr = (v, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};

// limit/offset used to be passed to Postgres unvalidated: limit=-1 or limit=abc was a 500
// and limit=100000 was an unbounded scan. Clamp instead.
export function clampPage(limit, offset) {
  const l = Math.min(MAX_LIMIT, Math.max(1, intOr(limit, DEFAULT_LIMIT)));
  const o = Math.max(0, intOr(offset, 0));
  return { limit: l, offset: o };
}

// filters: the raw /jobs query-string values.
// exclusions: null for anonymous requests, else
//   { dismissedJobIds, excludedCompanies, excludedTitles, excludedLocations, locationPref }
//   (companies and titles already normalised by the caller).
// nonUs: { regionCodesSql, titleRegexSql } for the "US-only" preference.
export function buildJobsQuery({ filters = {}, exclusions = null, nonUs = null } = {}) {
  const {
    keyword, location, remote, company, provider, posted_since, employment_type, salary_min, days,
  } = filters;
  const { limit, offset } = clampPage(filters.limit, filters.offset);

  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];

  if (keyword) where.push(`j.tsv @@ plainto_tsquery('english', ${p(keyword)})`);
  if (location) {
    const i = p(`%${location}%`);
    where.push(`EXISTS (
        SELECT 1 FROM job_location
        WHERE job_id = j.id
        AND (city ILIKE ${i} OR region ILIKE ${i} OR country ILIKE ${i})
      )`);
  }
  if (remote === 'true') where.push('j.remote = true');
  if (company) where.push(`c.name ILIKE ${p(`%${company}%`)}`);
  if (provider) where.push(`j.provider = ${p(provider)}`);
  if (posted_since) where.push(`j.posted_at >= ${p(posted_since)}`);
  if (days) where.push(`j.posted_at >= NOW() - (${p(parseInt(days, 10))} || ' days')::interval`);
  if (employment_type) where.push(`j.employment_type = ${p(employment_type)}`);
  if (salary_min) where.push(`j.salary_min >= ${p(salary_min)}`);

  let needsCompany = Boolean(company);
  if (exclusions) {
    const { dismissedJobIds = [], excludedCompanies = [], excludedTitles = [], excludedLocations = [], locationPref = '' } = exclusions;
    if (dismissedJobIds.length) where.push(`j.id != ALL(${p(dismissedJobIds)}::bigint[])`);
    if (excludedCompanies.length) {
      needsCompany = true;
      where.push(`c.name_normalized != ALL(${p(excludedCompanies)}::text[])`);
    }
    if (excludedTitles.length) {
      where.push(`lower(trim(regexp_replace(j.title, '\\s+', ' ', 'g'))) != ALL(${p(excludedTitles)}::text[])`);
    }
    if (excludedLocations.length) {
      const i = p(excludedLocations);
      where.push(`NOT EXISTS (
          SELECT 1 FROM job_location xl WHERE xl.job_id = j.id
            AND (xl.city = ANY(${i}::text[]) OR xl.region = ANY(${i}::text[]) OR xl.country = ANY(${i}::text[]))
        )`);
    }
    // Same non-US signal check as /jobs/personalized's wantsUS branch, applied only when the
    // user's stored location preference is the US.
    const loc = String(locationPref || '').trim().toLowerCase();
    if (nonUs && ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'].includes(loc)) {
      where.push(`(
          (
            NOT EXISTS (SELECT 1 FROM job_location anyloc WHERE anyloc.job_id = j.id)
            OR EXISTS (
              SELECT 1 FROM job_location jlf WHERE jlf.job_id = j.id
                AND (jlf.country IS NULL OR jlf.country ~* '\\y(usa|us|united states)\\y')
                AND (jlf.region IS NULL OR jlf.region !~* '\\y(${nonUs.regionCodesSql})\\y')
            )
          )
          AND j.title !~* '${nonUs.titleRegexSql}'
        )`);
    }
  }

  const limitIdx = p(limit);
  const offsetIdx = p(offset);

  // The company join stays out of the inner query unless a filter needs it: with it, the planner
  // may prefer hash-join-then-sort over walking the posted_at index and stopping after `limit` rows.
  const text = `
      SELECT j.*,
        c.name AS company_name,
        c.domain AS company_domain, c.logo_domain AS company_logo_domain,
        loc.cities, loc.countries
      FROM (
        SELECT j.id, j.posted_at
        FROM job j${needsCompany ? '\n        JOIN company c ON j.company_id = c.id' : ''}
        WHERE j.is_active = true AND j.company_id IS NOT NULL${where.map(w => `\n          AND ${w}`).join('')}
        ORDER BY j.posted_at DESC NULLS LAST, j.id DESC
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
      ) page
      JOIN job j ON j.id = page.id
      JOIN company c ON c.id = j.company_id
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) AS cities,
               array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) AS countries
        FROM job_location jl WHERE jl.job_id = j.id
      ) loc ON true
      ORDER BY page.posted_at DESC NULLS LAST, page.id DESC`;

  return { text, params, limit, offset };
}

export function jobsCacheKey(text, params, hash) {
  return hash(text + JSON.stringify(params));
}

// At most `max` heavy loads in flight; the rest wait. A burst of distinct filter combinations
// (the app fires one request per employment-type chip) can no longer occupy the whole pg pool.
export function createLimiter(max = 3) {
  let active = 0;
  const waiting = [];
  const next = () => { active--; const w = waiting.shift(); if (w) w(); };
  return async function limited(fn) {
    if (active >= max) await new Promise(r => waiting.push(r));
    active++;
    try { return await fn(); } finally { next(); }
  };
}

// Keeps the hottest listing fresh so even the first request after a restart or a quiet
// period is served from cache. Sequential, fail-open, unref'd timers.
export function startJobsWarmer({ cache, hotKeys, intervalMs = 50_000, initialDelayMs = 10_000, logger }) {
  let stopped = false;
  async function warmOnce() {
    for (const { key, load } of hotKeys()) {
      if (stopped) return;
      try { await cache.refresh(key, load); }
      catch (e) { try { logger?.warn?.({ error: e.message }, 'jobs warmer: refresh failed'); } catch { /* ignore */ } }
    }
  }
  const first = setTimeout(warmOnce, initialDelayMs);
  const timer = setInterval(warmOnce, intervalMs);
  first.unref?.();
  timer.unref?.();
  return { warmOnce, stop() { stopped = true; clearTimeout(first); clearInterval(timer); } };
}
