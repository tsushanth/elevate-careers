// src/services/feedReconcile.js
// Periodic repair for job_feed. The ingest hooks write job_feed at ingest time;
// this catches what they miss: a failed sync ("job_feed sync failed"), jobs whose
// location changed later, and jobs deactivated outside the normaliser.
//
// Bounded and idempotent: every query is a keyset page, capped in rows, with a
// pause between batches. Never throws.
//
// Two selections are merged:
//   1. 'missing from feed': newest JOB_SCAN_ROWS active jobs by id, no feed row.
//   2. 'updated in window': active jobs with updated_at >= now() - sinceHours,
//      keyset-paged newest first by (updated_at, id). This is only safe with the
//      partial index idx_job_active_updated_at (supabase/manual/
//      20261008000200_job_updated_at_index.sql); without it the query is a ~17 s
//      filter over every active row, so it is skipped (with a warning) and the
//      id window also checks updated_at, which is the previous behaviour.
// job.updated_at is maintained by the BEFORE UPDATE trigger update_job_updated_at
// (and defaults to now() on insert), so it is never null and never older than
// created_at; a created_at fallback is therefore redundant for the window.
import { syncJobFeedBatch, deactivateInFeed } from './jobFeed.js';

const JOB_SCAN_ROWS = 50_000;      // newest jobs by id examined per run (same window as the admin card)
const JOB_PAGE = 10_000;           // rows per page query
const MAX_RESYNC = 20_000;         // jobs re-synced per run; the rest is picked up next run
const MAX_UPDATED = 15_000;        // of MAX_RESYNC, so a bulk touch cannot starve the missing-from-feed check
const UPDATED_PAGE = 5_000;        // rows per updated_at page query
const UPDATED_INDEX = 'idx_job_active_updated_at';
const FEED_SCAN_ROWS = 20_000;     // newest feed rows examined per run (same window as the admin card)
const FEED_PAGE = 5_000;

const sleep = (ms) => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

// True only if the partial index exists and is valid (not mid CREATE INDEX CONCURRENTLY).
async function hasUpdatedAtIndex(db) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
       WHERE c.relname = $1 AND i.indisvalid AND i.indisready
         AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())`, [UPDATED_INDEX]);
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

// Active jobs updated within the window, newest first, via the updated_at index.
// The cursor keeps updated_at as text so microsecond precision survives the round trip.
async function findUpdatedInWindow(db, { sinceHours, sleepMs, limit }) {
  const ids = [];
  let curTs = null;
  let curId = null;
  while (ids.length < limit) {
    const { rows } = await db.query(
      `SELECT id::text AS id, updated_at::text AS ts FROM job
       WHERE is_active AND updated_at >= now() - ($1::float8 * interval '1 hour')
         AND ($2::timestamptz IS NULL OR updated_at < $2::timestamptz
              OR (updated_at = $2::timestamptz AND id < $3::bigint))
       ORDER BY updated_at DESC, id DESC LIMIT $4`,
      [sinceHours, curTs, curId, UPDATED_PAGE]);
    if (!rows.length) break;
    for (const r of rows) ids.push(r.id);
    curTs = rows[rows.length - 1].ts;
    curId = rows[rows.length - 1].id;
    if (rows.length < UPDATED_PAGE) break;
    await sleep(sleepMs);
  }
  return ids.slice(0, limit);
}

// Active jobs in the newest JOB_SCAN_ROWS that have no feed row (or, when the
// updated_at index is absent, were also touched in the window), plus every active
// job updated in the window when the index is available.
async function findJobsToSync(db, { sinceHours, sleepMs, logger }) {
  const indexed = await hasUpdatedAtIndex(db);
  let updatedIds = [];
  if (indexed) {
    updatedIds = await findUpdatedInWindow(db, { sinceHours, sleepMs, limit: MAX_UPDATED });
  } else {
    try { logger?.warn?.({ index: UPDATED_INDEX }, 'feed reconcile: updated_at index missing, scanning newest ids only'); } catch { /* ignore */ }
  }
  const cutoff = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
  const ids = [];
  let scanned = 0;
  let before = null; // keyset cursor: id < before
  while (scanned < JOB_SCAN_ROWS && ids.length + updatedIds.length < MAX_RESYNC) {
    const { rows } = await db.query(
      `SELECT j.id::text AS id,
              (COALESCE(j.updated_at, j.created_at) > $2::timestamptz
               OR NOT EXISTS (SELECT 1 FROM job_feed f WHERE f.job_id = j.id)) AS stale
       FROM (SELECT id, updated_at, created_at FROM job
             WHERE is_active AND ($1::bigint IS NULL OR id < $1::bigint)
             ORDER BY id DESC LIMIT $3) j`,
      [before, cutoff, JOB_PAGE]);
    if (!rows.length) break;
    for (const r of rows) if (r.stale) ids.push(r.id);
    scanned += rows.length;
    before = rows[rows.length - 1].id;
    if (rows.length < JOB_PAGE) break;
    await sleep(sleepMs);
  }
  const merged = [...new Set([...updatedIds, ...ids])];
  return { ids: merged.slice(0, MAX_RESYNC), scanned, updatedWindow: updatedIds.length, indexed };
}

// Feed job_ids (newest first) whose job is inactive or gone.
async function findStaleFeedJobs(db, { sleepMs }) {
  const stale = [];
  let scanned = 0;
  let before = null;
  while (scanned < FEED_SCAN_ROWS) {
    const { rows } = await db.query(
      `SELECT job_id::text AS job_id FROM job_feed
       WHERE is_active AND ($1::bigint IS NULL OR job_id < $1::bigint)
       ORDER BY job_id DESC LIMIT $2`, [before, FEED_PAGE]);
    if (!rows.length) break;
    scanned += rows.length;
    before = rows[rows.length - 1].job_id;
    const feedIds = [...new Set(rows.map(r => r.job_id))];
    // Probe job by primary key; anything not returned as active is inactive or deleted.
    const { rows: live } = await db.query(
      'SELECT id::text AS id FROM job WHERE id = ANY($1::bigint[]) AND is_active', [feedIds]);
    const liveSet = new Set(live.map(r => r.id));
    for (const id of feedIds) if (!liveSet.has(id)) stale.push(id);
    if (rows.length < FEED_PAGE) break;
    await sleep(sleepMs);
  }
  return { ids: stale, scanned };
}

// job_feed has no synced-at column, so the window is re-selected every run: keep it short (6 h of
// updates is ~3k jobs) or each hourly run and each deploy would re-sync the same newest 15k rows.
export async function reconcileFeed(db, { sinceHours = 6, batch = 500, sleepMs = 100, logger = null } = {}) {
  const stats = { jobsScanned: 0, resynced: 0, resyncFailed: 0, feedScanned: 0, deactivated: 0, errors: 0 };
  const warn = (obj, msg) => { try { logger?.warn?.(obj, msg); } catch { /* logging must not throw */ } };
  const size = Math.max(1, Math.floor(Number(batch)) || 500);

  try {
    const { ids, scanned, updatedWindow, indexed } = await findJobsToSync(db, { sinceHours, sleepMs, logger });
    stats.jobsScanned = scanned;
    stats.updatedInWindow = updatedWindow;
    stats.updatedIndex = indexed;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      try { await syncJobFeedBatch(db, chunk); stats.resynced += chunk.length; }
      catch (e) { stats.resyncFailed += chunk.length; stats.errors++; warn({ error: e.message }, 'feed reconcile: resync batch failed'); }
      await sleep(sleepMs);
    }
  } catch (e) { stats.errors++; warn({ error: e.message }, 'feed reconcile: resync phase failed'); }

  try {
    const { ids, scanned } = await findStaleFeedJobs(db, { sleepMs });
    stats.feedScanned = scanned;
    for (let i = 0; i < ids.length; i += size) {
      const chunk = ids.slice(i, i + size);
      try { await deactivateInFeed(db, chunk); stats.deactivated += chunk.length; }
      catch (e) { stats.errors++; warn({ error: e.message }, 'feed reconcile: deactivate batch failed'); }
      await sleep(sleepMs);
    }
  } catch (e) { stats.errors++; warn({ error: e.message }, 'feed reconcile: deactivate phase failed'); }

  try { logger?.info?.(stats, 'feed reconcile done'); } catch { /* ignore */ }
  return stats;
}

// Same fail-open style as startFeedWarmer. First run is delayed so a deploy
// does not add load while the instance is still warming up.
export function startFeedReconcile({ db, logger, intervalMs = 3_600_000, initialDelayMs = 300_000, sinceHours = 6, batch = 500 }) {
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try { await reconcileFeed(db, { sinceHours, batch, logger }); }
    catch (e) { try { logger?.warn?.({ error: e.message }, 'feed reconcile: run failed'); } catch { /* ignore */ } }
    finally { running = false; }
  }

  const first = setTimeout(tick, initialDelayMs);
  const timer = setInterval(tick, intervalMs);
  first.unref?.();
  timer.unref?.();
  return { stop() { stopped = true; clearTimeout(first); clearInterval(timer); } };
}
