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
import { loadAppliedJobIds } from '../services/appliedJobs.js';
import { normalizePrefs } from '../services/feedPrefs.js';
import { roleMatchEnabled } from '../services/roleMatch.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
  return _supabase;
}

// The role profile: explicit apply_preferences.keywords, else user_signals.preferred_titles (roleMatch.js
// turns them into phrases). Auxiliary like the preferences: any failure fails open (X-Prefs: unavailable).
// Skipped entirely while FEED_ROLE_MATCH is off.
async function loadProfile(sb, userId) {
  if (!roleMatchEnabled()) return { profile: null, profileUnavailable: false };
  try {
    const [kw, sig] = await Promise.all([
      sb.from('apply_preferences').select('keywords').eq('user_id', userId).maybeSingle(),
      sb.from('user_signals').select('preferred_titles').eq('user_id', userId).maybeSingle(),
    ]);
    if (kw.error) throw new Error(kw.error.message || 'keywords query failed');
    if (sig.error) throw new Error(sig.error.message || 'signals query failed');
    const keywords = Array.isArray(kw.data?.keywords) ? kw.data.keywords : [];
    const preferredTitles = Array.isArray(sig.data?.preferred_titles) ? sig.data.preferred_titles : [];
    return { profile: keywords.length || preferredTitles.length ? { keywords, preferredTitles } : null, profileUnavailable: false };
  } catch (e) {
    logger.warn({ error: e.message }, 'v2 feed: role profile unavailable, serving without it');
    return { profile: null, profileUnavailable: true };
  }
}

// Optional auth, like /jobs: a bad or missing token just means no exclusions.
async function getExclusions(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return null;
    const [{ data: pref }, { data: dismissedRows }, prefsRes] = await Promise.all([
      sb.from('apply_preferences').select('excluded_companies').eq('user_id', user.id).single(),
      sb.from('dismissed_jobs').select('job_id').eq('user_id', user.id),
      // Separate query so a problem with the preference columns cannot lose the company/dismissed exclusions.
      sb.from('apply_preferences').select('remote, salary_min, excluded_titles, excluded_locations').eq('user_id', user.id).maybeSingle()
        .then(r => r, e => ({ data: null, error: e })),
    ]);
    // Fail open: preferences are an enhancement. No row is fine (data null, no error).
    let prefs = null, prefsUnavailable = false;
    try {
      if (prefsRes.error) throw new Error(prefsRes.error.message || 'preferences query failed');
      prefs = normalizePrefs(prefsRes.data);
    } catch (e) {
      prefsUnavailable = true;
      logger.warn({ error: e.message }, 'v2 feed: saved preferences unavailable, serving without them');
    }
    // Applied jobs are hidden like dismissed ones. A failure here must not lose the dismissed list.
    let applied = [];
    try { applied = await loadAppliedJobIds({ sb, db, userId: user.id }); }
    catch (e) { logger.warn({ error: e.message }, 'v2 feed: applied-jobs lookup failed, continuing without it'); }
    const { profile, profileUnavailable } = await loadProfile(sb, user.id);
    const dismissed = [...new Set([...(dismissedRows || []).map(r => Number(r.job_id)).filter(Number.isFinite), ...applied])];
    return {
      userId: user.id,
      dismissed,
      excludedCompanies: (pref?.excluded_companies || []).map(normalizeCompanyName),
      prefs,
      prefsUnavailable,
      profile,
      profileUnavailable,
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
