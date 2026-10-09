// src/routes/feed-core.js
import express from 'express';
import { parseFeedParams, buildFeedQuery, buildCountQuery, buildExcludedCountQuery, feedCacheKey, encodeCursor, feedOrderMode, fitRankEnabled, COUNT_CAP, EXACT_EXCLUSION_MAX } from '../services/feedQuery.js';
import { suggestPlaces, placeCount, isAbsorbing } from '../services/geoPlace.js';
import { COUNTRY_NAME_BY_ISO } from '../services/places.js';
import { activePrefs, hasSoft, isDefaultList } from '../services/feedPrefs.js';
import { nearEnabled, nearApplicable, resolveHome, clientIp, nearPayload, homeSig } from '../services/nearHome.js';
import { geoip as defaultGeoip } from '../services/geoip.js';
import { roleList, roleLabel, roleMatchEnabled, profilePhrases, profileFilter, fitFilter, resolveFamilies } from '../services/roleMatch.js';

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

export function createFeedRouter({ db, cache, getExclusions, geoip = defaultGeoip, logger = { warn() {}, error() {} } }) {
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
  // `home` ({ regions, sig }, nearHome.js) turns on the two-tier "near home first" order for this page.
  async function loadPage(params, exclusions = {}, home = null) {
    const opts = { absorb: params.city && params.region ? await isAbsorbing(db, params) : false };
    if (home) opts.near = { regions: home.regions, ...(home.fit ? { fit: home.fit } : {}) };
    const mode = feedOrderMode();
    const q = buildFeedQuery(params, exclusions, { ...opts, mode });
    const { rows } = await db.query(q.text, q.values);
    const hasMore = rows.length > params.limit;
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    // Invariant: job_feed.sort_at (and so feed_at = sort_at - whole hours) is always written with
    // millisecond precision (see jobFeed.js), so this cursor round-trips exactly. The cursor
    // carries the ordering key of the active mode, not necessarily posted_at.
    const nextCursor = hasMore && last ? encodeCursor(new Date(last.order_key).toISOString(), Number(last.id), mode, home ? { tier: Number(last.tier), sig: home.sig, bucket: home.fit ? Number(last.bucket) : undefined } : null) : null;

    let count = null;
    let countIsCapped = false;
    if (!params.cursor) {
      let exact = null;
      // The subtraction below is only exact for pure exclusions; title/location/soft preferences use the real (capped) count.
      if (params.plain && !exclusions.prefs && !exclusions.match) {
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
    return { jobs: page.map(({ order_key, tier, bucket, ...r }) => toCard(r)), nextCursor, count, countIsCapped };
  }
  router.loadPage = loadPage;

  router.get('/jobs/feed', async (req, res) => {
    const parsed = parseFeedParams(req.query);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    // A cursor minted under the other ordering (FEED_ORDER flipped, or a rolling deploy) cannot be
    // continued without duplicates or gaps: tell the client to restart from the first page.
    if (parsed.params.cursor && parsed.params.cursor.mode !== feedOrderMode()) {
      return res.status(409).json({ error: 'cursor expired', restart: true });
    }
    // FEED_ROLE_MATCH kill switch: an explicit role is refused (not silently ignored) while it is off.
    const roleOn = roleMatchEnabled();
    if (parsed.params.role && !roleOn) return res.status(400).json({ error: 'role filter disabled' });
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
      // Saved preferences: hard ones always, soft ones only on the default list and not with prefs=off.
      const prefsOff = req.query.prefs === 'off';
      let prefsStatus;
      let match = null;          // response `match` (only when a role or the profile was applied)
      let profileMatch = null;   // { tsquery } handed to the SQL builder (profile only; a role rides in params.role)
      let fit = null;            // { strong, labels } (roleMatch.js fitFilter): the fit buckets, profile default list only
      if (parsed.params.role) {
        match = { source: 'role', roleSlug: parsed.params.role, roleLabel: roleLabel(parsed.params.role), labels: [roleLabel(parsed.params.role)] };
      }
      if (exclusions) {
        if (exclusions.prefsUnavailable || exclusions.profileUnavailable) res.set('X-Prefs', 'unavailable');
        const active = activePrefs(exclusions.prefs, parsed.params, { off: prefsOff });
        // The profile match is one more soft preference: default list only, never over an explicit role, off with prefs=off.
        const phrases = roleOn && exclusions.profile ? profilePhrases(exclusions.profile).phrases : [];
        const defaultList = isDefaultList(parsed.params);
        if (phrases.length && !parsed.params.role && !prefsOff && defaultList) {
          let families = [];
          try { families = await resolveFamilies(db, phrases.map(p => p.text)); }
          catch (e) { logger.warn({ error: e.message }, 'profile families unavailable; matching the profile phrases only'); }
          const filter = profileFilter(phrases, families);
          if (filter) {
            profileMatch = filter;
            match = { source: 'profile', roleSlug: null, roleLabel: null, labels: phrases.map(p => p.label) };
            if (fitRankEnabled()) fit = fitFilter(phrases, exclusions.profile, families);
          }
        }
        if ((active && (active.remote || active.salaryMin !== null)) || profileMatch) prefsStatus = 'applied';
        else if (prefsOff && defaultList && (hasSoft(exclusions.prefs) || phrases.length)) prefsStatus = 'off';
        exclusions = { ...exclusions, prefs: active, match: profileMatch };
      }
      // Near home first (nearHome.js): FEED_NEAR kill switch, a country-level list only, ?near=off opts out.
      let home = null;
      if (nearEnabled() && nearApplicable(parsed.params) && req.query.near !== 'off') {
        try {
          home = resolveHome({ country: parsed.params.country, profileLocation: exclusions?.location, ip: clientIp(req), tz: req.query.tz, geo: geoip });
        } catch (e) {
          logger.warn({ error: e.message }, 'near-home resolution failed; serving the plain list');
        }
      }
      // Fit buckets live inside the near tiers: they need a home. The signature (n3f) and the cursor's bucket make a
      // bucketed cursor continue only a bucketed list of the same home, and vice versa (409 restart otherwise).
      if (home && fit) {
        home = { ...home, sig: homeSig(home.regions, true), fit: { strong: fit.strong, bucket1: fit.bucket1 } };
        if (fit.labels.length) match = { ...match, fit: fit.labels };
      }
      // A cursor continues only the list it came from: tiered cursors need the same home, plain ones need no home.
      const cur = parsed.params.cursor;
      if (cur && (home ? (cur.tier == null || cur.sig !== home.sig || (cur.bucket !== undefined) !== !!home.fit) : cur.tier != null)) {
        return res.status(409).json({ error: 'cursor expired', restart: true });
      }
      if (home) res.set('Cache-Control', 'private, no-cache');   // the page depends on who asks
      const extras = { ...(prefsStatus ? { prefs: prefsStatus } : {}), ...(match ? { match } : {}), ...(home ? { near: nearPayload(home) } : {}) };
      if ((exclusions && (exclusions.dismissed.length || exclusions.excludedCompanies.length || exclusions.prefs || exclusions.match)) || home?.source === 'profile') {
        // Per-user results are never shared through the cache (a profile-derived home is per user too).
        res.set('X-Cache', 'BYPASS');
        const page = await loadPage(parsed.params, exclusions || {}, home);
        return res.json({ ...page, ...extras });
      }
      const { value, status } = await cache.getOrLoad(feedCacheKey(parsed.params, undefined, home), () => loadPage(parsed.params, {}, home));
      res.set('X-Cache', status);
      return res.json({ ...value, ...extras });   // 'off': nothing is filtered, the shared page is right
    } catch (e) {
      logger.error({ error: e.message }, 'feed load failed');
      return res.status(500).json({ error: 'Failed to load jobs' });
    }
  });

  // The job-function families, in display order. Empty while the feature is off so the UI hides itself.
  router.get('/roles', (req, res) => {
    const on = roleMatchEnabled();
    res.set('Cache-Control', `public, max-age=${on ? 3600 : 60}`);   // short while off so the flip shows up quickly
    res.json({ roles: on ? roleList() : [] });
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
