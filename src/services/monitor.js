// Dead-man checks that need no request to fire. Runs in the always-on worker machine.
// Pure evaluators are exported for tests; start() wires them to the DB / BullMQ and reports via the central reporter.
import { reportFailure } from '../utils/failureReporter.js';

const HOUR = 3600_000;

/** Ingestion jobs are waiting but nothing has completed for `staleMs` => the worker is wedged. */
export function evaluateQueue({ waiting, active, failed, lastCompletedAt, now = Date.now(), staleMs = 2 * HOUR }) {
  const problems = [];
  if (waiting > 0 && active === 0 && (lastCompletedAt == null || now - lastCompletedAt > staleMs)) problems.push('queue_stalled');
  if (waiting > 5000) problems.push('queue_backlog');
  if (failed > 200) problems.push('queue_many_failed');
  return problems;
}

/** The daily ingestion cron touches job.updated_at on every re-ingest; nothing for `staleMs` => ingestion is dead. */
export function evaluateIngestFreshness({ newestUpdatedAt, now = Date.now(), staleMs = 30 * HOUR }) {
  if (newestUpdatedAt == null) return ['ingest_no_jobs'];
  return now - new Date(newestUpdatedAt).getTime() > staleMs ? ['ingest_stale'] : [];
}

/** Auto-apply rows stuck queued/running (worker died, job lost) or mostly failing => apply pipeline broken. */
export function evaluateApplies({ stuck, failedRecent, finishedRecent }) {
  const problems = [];
  if (stuck > 0) problems.push('apply_stuck');
  if (finishedRecent >= 5 && failedRecent / finishedRecent >= 0.5) problems.push('apply_mostly_failing');
  return problems;
}

const MESSAGES = {
  queue_stalled: 'ingestion queue stalled: jobs waiting, none completing',
  queue_backlog: 'ingestion queue backlog above 5000',
  queue_many_failed: 'ingestion queue has more than 200 failed jobs',
  ingest_stale: 'job ingestion stale: no job updated in 30 hours',
  ingest_no_jobs: 'job table empty or unreadable',
  apply_stuck: 'auto-apply rows stuck in queued/running for over 30 minutes',
  apply_mostly_failing: 'auto-apply failing for at least half of recent runs',
};

export function reportProblems(flow, problems, context = {}) {
  for (const p of problems) reportFailure(flow, MESSAGES[p] || p, { check: p, ...context });
}

export async function runChecks({ db, queue, applyQueue }) {
  try {
    if (queue) {
      const c = await queue.getJobCounts('waiting', 'active', 'failed');
      const last = await queue.getJobs(['completed'], 0, 0, false);
      const lastCompletedAt = last[0]?.finishedOn ?? null;
      reportProblems('monitor:ingest-queue', evaluateQueue({ ...c, lastCompletedAt }), { waiting: String(c.waiting) });
    }
    const f = await db.query('SELECT MAX(updated_at) AS newest FROM job');
    reportProblems('monitor:ingest-freshness', evaluateIngestFreshness({ newestUpdatedAt: f.rows[0]?.newest }));
    const a = await db.query(`SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','running') AND updated_at < NOW() - INTERVAL '30 minutes') AS stuck,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours') AS failed_recent,
        COUNT(*) FILTER (WHERE status IN ('failed','submitted','preview') AND updated_at > NOW() - INTERVAL '24 hours') AS finished_recent
      FROM job_applications`);
    const r = a.rows[0] || {};
    reportProblems('monitor:apply', evaluateApplies({ stuck: +r.stuck, failedRecent: +r.failed_recent, finishedRecent: +r.finished_recent }));
  } catch (err) {
    // A monitor that cannot run is itself a blind spot.
    reportFailure('monitor:self', 'monitor check could not run', { error: String(err?.code || err?.name || 'unknown') });
  }
}

export function startMonitor(deps, intervalMs = 15 * 60_000) {
  const t = setInterval(() => { void runChecks(deps); }, intervalMs);
  t.unref?.();
  return t;
}
