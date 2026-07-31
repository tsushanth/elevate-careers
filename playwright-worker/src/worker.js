import { Worker } from 'bullmq';
import pg from 'pg';
import { runApply } from './browser.js';

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
});

console.log('[worker] playwright-apply worker started, concurrency=2');
