// src/routes/feed.js
// Wiring for the /v2 feed: real db, Redis cache, Supabase auth, warmer.
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { getRedis } from '../services/redis.js';
import { createFeedCache } from '../services/feedCache.js';
import { createFeedRouter } from './feed-core.js';
import { rebuildGeoPlaces } from '../services/geoPlace.js';
import { startFeedWarmer } from '../services/feedWarmer.js';
import { startFeedReconcile } from '../services/feedReconcile.js';
import { normalizeCompanyName } from '../services/normalizer.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
  return _supabase;
}

// Optional auth, like /jobs: a bad or missing token just means no exclusions.
async function getExclusions(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return null;
    const [{ data: pref }, { data: dismissedRows }] = await Promise.all([
      sb.from('apply_preferences').select('excluded_companies').eq('user_id', user.id).single(),
      sb.from('dismissed_jobs').select('job_id').eq('user_id', user.id),
    ]);
    return {
      userId: user.id,
      dismissed: (dismissedRows || []).map(r => Number(r.job_id)).filter(Number.isFinite),
      excludedCompanies: (pref?.excluded_companies || []).map(normalizeCompanyName),
    };
  } catch (e) {
    logger.warn({ error: e.message }, 'v2 feed: exclusions lookup failed, continuing unfiltered');
    return null;
  }
}

const cache = createFeedCache({ redis: getRedis(), ttlMs: 60_000, staleMs: 300_000 });
const router = createFeedRouter({ db, cache, getExclusions, logger });

// FEED_WARMER=off is the kill switch.
if (process.env.FEED_WARMER !== 'off') {
  startFeedWarmer({
    db, cache, loadPage: router.loadPage, rebuildPlaces: () => rebuildGeoPlaces(db), logger,
  });
}

// FEED_RECONCILE_DISABLED=1 is the kill switch. Hourly, first run ~5 min after boot.
if (process.env.FEED_RECONCILE_DISABLED !== '1') {
  startFeedReconcile({ db, logger });
}

export const ingestRouter = express.Router();
ingestRouter.post('/rebuild-geo-places', async (req, res) => {
  if (!process.env.INGEST_SECRET || req.body?.secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try { res.json({ ok: true, ...(await rebuildGeoPlaces(db)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
