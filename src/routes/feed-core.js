// src/routes/feed-core.js
import express from 'express';
import { parseFeedParams, buildFeedQuery, buildCountQuery, feedCacheKey, encodeCursor, COUNT_CAP } from '../services/feedQuery.js';
import { suggestPlaces, placeCount } from '../services/geoPlace.js';
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

export function createFeedRouter({ db, cache, getExclusions }) {
  const router = express.Router();

  // The page itself (rows, next cursor, count). Reused by the warmer.
  async function loadPage(params, exclusions = {}) {
    const q = buildFeedQuery(params, exclusions);
    const { rows } = await db.query(q.text, q.values);
    const hasMore = rows.length > params.limit;
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(new Date(last.posted_at).toISOString(), Number(last.id)) : null;

    let count = null;
    let countIsCapped = false;
    if (!params.cursor) {
      const exact = params.plain && !(exclusions.dismissed?.length || exclusions.excludedCompanies?.length)
        ? await placeCount(db, params) : null;
      if (exact !== null) {
        count = exact;
      } else {
        const c = buildCountQuery(params, exclusions);
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
      const exclusions = req.headers.authorization ? await getExclusions(req) : null;
      if (exclusions && (exclusions.dismissed.length || exclusions.excludedCompanies.length)) {
        // Per-user results are never shared through the cache.
        res.set('X-Cache', 'BYPASS');
        return res.json(await loadPage(parsed.params, exclusions));
      }
      const { value, status } = await cache.getOrLoad(feedCacheKey(parsed.params), () => loadPage(parsed.params));
      res.set('X-Cache', status);
      return res.json(value);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to load jobs' });
    }
  });

  router.get('/geo/suggest', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ places: await suggestPlaces(db, req.query.q) });
    } catch {
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
    } catch {
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  return router;
}
