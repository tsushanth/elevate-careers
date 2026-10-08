// src/services/feedReconcile.js
// Periodic repair for job_feed. The ingest hooks write job_feed at ingest time;
// this catches what they miss: a failed sync ("job_feed sync failed"), jobs whose
// location changed later, and jobs deactivated outside the normaliser.
//
// Bounded and idempotent: every query is a keyset page over a primary key
// (no job.updated_at index exists, so we never filter on it across the whole
// table), capped in rows, with a pause between batches. Never throws.
import { syncJobFeedBatch, deactivateInFeed } from './jobFeed.js';

const JOB_SCAN_ROWS = 50_000;      // newest jobs by id examined per run (same window as the admin card)
const JOB_PAGE = 10_000;           // rows per page query
const MAX_RESYNC = 20_000;         // jobs re-synced per run; the rest is picked up next run
const FEED_SCAN_ROWS = 20_000;     // newest feed rows examined per run (same window as the admin card)
const FEED_PAGE = 5_000;

const sleep = (ms) => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

// Active jobs in the newest JOB_SCAN_ROWS that were touched in the window or have no feed row.
async function findJobsToSync(db, { sinceHours, sleepMs }) {
  const cutoff = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
  const ids = [];
  let scanned = 0;
  let before = null; // keyset cursor: id < before
  while (scanned < JOB_SCAN_ROWS && ids.length < MAX_RESYNC) {
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
  return { ids: ids.slice(0, MAX_RESYNC), scanned };
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

export async function reconcileFeed(db, { sinceHours = 48, batch = 500, sleepMs = 100, logger = null } = {}) {
  const stats = { jobsScanned: 0, resynced: 0, resyncFailed: 0, feedScanned: 0, deactivated: 0, errors: 0 };
  const warn = (obj, msg) => { try { logger?.warn?.(obj, msg); } catch { /* logging must not throw */ } };
  const size = Math.max(1, Math.floor(Number(batch)) || 500);

  try {
    const { ids, scanned } = await findJobsToSync(db, { sinceHours, sleepMs });
    stats.jobsScanned = scanned;
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
export function startFeedReconcile({ db, logger, intervalMs = 3_600_000, initialDelayMs = 300_000, sinceHours = 48, batch = 500 }) {
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
