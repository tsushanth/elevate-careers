// src/routes/feed-core.js
import express from 'express';
import { parseFeedParams, buildFeedQuery, buildCountQuery, buildExcludedCountQuery, feedCacheKey, encodeCursor, COUNT_CAP, EXACT_EXCLUSION_MAX } from '../services/feedQuery.js';
import { suggestPlaces, placeCount, isAbsorbing } from '../services/geoPlace.js';
import { COUNTRY_NAME_BY_ISO } from '../services/places.js';

const STATS_TTL_MS = 10 * 60_000;

// pg returns bigint and numeric columns as strings; the API contract uses numbers.
const num = (v) => (v == null ? null : Number(v));
function toCard(row) {
  return {
    ...row,
    id: Number(row.id),
    salary_min: num(row.salary_min),
    salary_max: num(row.salary_max),
    country: COUNTRY_NAME_BY_ISO[row.country_code] || null,
  };
}

export function createFeedRouter({ db, cache, getExclusions, logger = { warn() {}, error() {} } }) {
  const router = express.Router();

  // Signed-in exact count: the precomputed place count (the one anonymous users
  // see) minus the user's excluded rows inside the same filter. Returns null
  // (caller falls back to the capped count) when the exclusion list is too large
  // or the query fails. Clamped at 0 because geo_place.job_count can lag the live table.
  async function subtractExclusions(base, params, exclusions, opts) {
    const size = (exclusions.dismissed?.length || 0) + (exclusions.excludedCompanies?.length || 0);
    if (size > EXACT_EXCLUSION_MAX) return null;
    try {
      const q = buildExcludedCountQuery(params, exclusions, opts);
      const n = Number((await db.query(q.text, q.values)).rows[0].n);
      return Math.max(0, base - n);
    } catch (e) {
      logger.warn({ error: e.message }, 'exclusion count failed; using capped count');
      return null;
    }
  }

  // The page itself (rows, next cursor, count). Reused by the warmer.
  async function loadPage(params, exclusions = {}) {
    const opts = { absorb: params.city && params.region ? await isAbsorbing(db, params) : false };
    const q = buildFeedQuery(params, exclusions, opts);
    const { rows } = await db.query(q.text, q.values);
    const hasMore = rows.length > params.limit;
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    // Invariant: job_feed.sort_at is always written with millisecond precision (see jobFeed.js), so this cursor round-trips exactly.
    const nextCursor = hasMore && last ? encodeCursor(new Date(last.posted_at).toISOString(), Number(last.id)) : null;

    let count = null;
    let countIsCapped = false;
    if (!params.cursor) {
      let exact = null;
      if (params.plain) {
        const ex = exclusions.dismissed?.length || exclusions.excludedCompanies?.length;
        exact = await placeCount(db, params);
        if (exact !== null && ex) exact = await subtractExclusions(exact, params, exclusions, opts);
      }
      if (exact !== null) {
        count = exact;
      } else {
        const c = buildCountQuery(params, exclusions, opts);
        const n = (await db.query(c.text, c.values)).rows[0].n;
        countIsCapped = n > COUNT_CAP;
        count = countIsCapped ? COUNT_CAP : n;
      }
    }
    return { jobs: page.map(toCard), nextCursor, count, countIsCapped };
  }
  router.loadPage = loadPage;

  router.get('/jobs/feed', async (req, res) => {
    const parsed = parseFeedParams(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    try {
      let exclusions = null;
      if (req.headers.authorization) {
        try {
          exclusions = await getExclusions(req);
        } catch (e) {
          // Auxiliary: serve the anonymous (cacheable) feed rather than failing.
          logger.warn({ error: e.message }, 'getExclusions failed; serving anonymous feed');
          res.set('X-Exclusions', 'unavailable');
        }
      }
      if (exclusions && (exclusions.dismissed.length || exclusions.excludedCompanies.length)) {
        // Per-user results are never shared through the cache.
        res.set('X-Cache', 'BYPASS');
        return res.json(await loadPage(parsed.params, exclusions));
      }
      const { value, status } = await cache.getOrLoad(feedCacheKey(parsed.params), () => loadPage(parsed.params));
      res.set('X-Cache', status);
      return res.json(value);
    } catch (e) {
      logger.error({ error: e.message }, 'feed load failed');
      return res.status(500).json({ error: 'Failed to load jobs' });
    }
  });

  router.get('/geo/suggest', async (req, res) => {
    try {
      const places = await suggestPlaces(db, req.query.q);
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ places });
    } catch (e) {
      logger.error({ error: e.message }, 'geo suggest failed');
      res.set('Cache-Control', 'no-store');
      res.status(500).json({ error: 'Failed to load places' });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const { value } = await cache.getOrLoad('stats', async () => {
        const { rows: [r] } = await db.query(
          `SELECT count(*) FILTER (WHERE is_primary)::int AS jobs,
                  count(*) FILTER (WHERE is_primary AND remote)::int AS remote,
                  count(DISTINCT company_key) FILTER (WHERE is_primary)::int AS companies
           FROM job_feed WHERE is_active`);
        return r;
      });
      res.set('Cache-Control', `public, max-age=${STATS_TTL_MS / 1000}`);
      res.json(value);
    } catch (e) {
      logger.error({ error: e.message }, 'stats failed');
      res.set('Cache-Control', 'no-store');
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  return router;
}
