// src/services/feedWarmer.js
// Keeps the hot first pages fresh so no visitor pays a cold query, and
// rebuilds the typeahead places hourly. Sequential on purpose (no DB spike).
import { parseFeedParams, feedCacheKey } from './feedQuery.js';

const TOP_COUNTRIES = 8;

export async function hotFeedQueries(db) {
  const { rows } = await db.query(
    `SELECT country_code FROM geo_place WHERE type = 'country' ORDER BY job_count DESC LIMIT $1`, [TOP_COUNTRIES]);
  return [{}, ...rows.map(r => ({ country: r.country_code }))];
}

export function startFeedWarmer({ db, cache, loadPage, rebuildPlaces, intervalMs = 60_000, placeIntervalMs = 3_600_000, logger }) {
  let stopped = false;

  async function warmOnce() {
    let queries;
    try { queries = await hotFeedQueries(db); } catch (e) { logger.warn({ error: e.message }, 'feed warmer: could not list hot queries'); return; }
    for (const q of queries) {
      if (stopped) return;
      const parsed = parseFeedParams(q);
      if (!parsed.ok) continue;
      try { await cache.refresh(feedCacheKey(parsed.params), () => loadPage(parsed.params)); }
      catch (e) { logger.warn({ error: e.message, query: q }, 'feed warmer: refresh failed'); }
    }
  }

  async function rebuild() {
    if (stopped) return;
    try { await rebuildPlaces(); } catch (e) { logger.warn({ error: e.message }, 'geo places rebuild failed'); }
  }

  // Places first (so hot queries know the top countries), then warm.
  rebuild().then(warmOnce);
  const warmTimer = setInterval(warmOnce, intervalMs);
  const placeTimer = setInterval(rebuild, placeIntervalMs);
  warmTimer.unref?.();
  placeTimer.unref?.();

  return { stop() { stopped = true; clearInterval(warmTimer); clearInterval(placeTimer); } };
}
