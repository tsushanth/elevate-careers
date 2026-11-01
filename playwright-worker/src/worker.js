import { Worker } from 'bullmq';
import pg from 'pg';
import { runApply } from './browser.js';
import { reportFailure, reportCrash, reportProviderError } from './failureReporter.js';

const { Pool } = pg;

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const redis = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

const worker = new Worker(
  'playwright-apply',
  async (job) => {
    const { applicationId, jobUrl, profile, jobDescription, dryRun } = job.data;
    console.log(`[worker] job ${job.id} — ${jobUrl}`);

    await db.query(
      `UPDATE job_applications SET status = 'running', updated_at = NOW() WHERE id = $1`,
      [applicationId]
    );

    let result;
    try {
      result = await runApply({ jobUrl, profile, jobDescription, dryRun });
    } catch (err) {
      console.error(`[worker] run failed job ${job.id}:`, err.message);
      reportProviderError('anthropic', err);
      reportFailure('apply-worker', 'auto-apply browser run failed', {});
      await db.query(
        `UPDATE job_applications SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`,
        [applicationId, err.message]
      );
      throw err;
    }

    const { filled, skipped, errored, fieldCount, aiUsed, aiFields, screenshot, company } = result;

    await db.query(
      `UPDATE job_applications SET
         status = $2,
         filled_fields = $3,
         skipped_fields = $4,
         errored_fields = $5,
         field_count = $6,
         ai_used = $7,
         ai_fields = $8,
         screenshot_b64 = $9,
         company = COALESCE($10, company),
         updated_at = NOW()
       WHERE id = $1`,
      [
        applicationId,
        dryRun ? 'preview' : 'submitted',
        filled,
        skipped,
        errored,
        fieldCount,
        aiUsed,
        JSON.stringify(aiFields || []),
        screenshot,
        company,
      ]
    );

    console.log(`[worker] done job ${job.id} — filled=${filled} skipped=${skipped} errored=${errored}`);
    return { filled, skipped, errored, fieldCount };
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

worker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  // Run failures are reported above with a stable message; this also covers failures outside runApply (DB update,
  // lost job). Final attempt only, so a retry that succeeds is not an alert.
  if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
    reportFailure('apply-worker', 'auto-apply job failed permanently', { attempts: String(job.attemptsMade) });
  }
});

worker.on('stalled', (jobId) => {
  console.error(`[worker] job ${jobId} stalled`);
  reportFailure('apply-worker', 'auto-apply job stalled', {});
});

// Redis errors (connection lost, auth) arrive here; BullMQ reconnects itself, so report instead of crashing.
worker.on('error', (err) => {
  console.error('[worker] error:', err.message);
  reportFailure('apply-worker', 'apply worker redis/queue error', { code: String(err?.code || 'unknown') });
});

process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection', reason);
  reportFailure('unhandled-rejection', 'unhandled promise rejection', { service: 'playwright-worker' });
});
process.on('uncaughtException', async (err) => {
  console.error('[worker] uncaughtException', err);
  await reportCrash('uncaught-exception:playwright-worker', err);
  process.exit(1);
});

// Dead-man: apply rows stuck queued/running (machine died mid-job, job lost) or mostly failing. This service has
// no HTTP port for the reporter to probe, so it watches itself.
setInterval(async () => {
  try {
    const { rows } = await db.query(`SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','running') AND updated_at < NOW() - INTERVAL '30 minutes') AS stuck,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours') AS failed_recent,
        COUNT(*) FILTER (WHERE status IN ('failed','submitted','preview') AND updated_at > NOW() - INTERVAL '24 hours') AS finished_recent
      FROM job_applications`);
    const r = rows[0] || {};
    if (+r.stuck > 0) reportFailure('monitor:apply', 'auto-apply rows stuck in queued/running for over 30 minutes', { stuck: String(r.stuck) });
    if (+r.finished_recent >= 5 && +r.failed_recent / +r.finished_recent >= 0.5) {
      reportFailure('monitor:apply', 'auto-apply failing for at least half of recent runs', { failed: String(r.failed_recent), finished: String(r.finished_recent) });
    }
  } catch (err) {
    reportFailure('monitor:self', 'apply monitor check could not run', { error: String(err?.code || err?.name || 'unknown') });
  }
}, 15 * 60_000).unref();

console.log('[worker] playwright-apply worker started, concurrency=2');
