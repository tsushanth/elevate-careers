import express from 'express';
import { Queue } from 'bullmq';
import { connection } from '../services/queue.js';
import { db } from '../db/index.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
  return _supabase;
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { data: { user }, error } = await getSupabase().auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Auth check failed' });
  }
}

let _applyQueue = null;
function getApplyQueue() {
  if (!_applyQueue && connection) {
    _applyQueue = new Queue('playwright-apply', {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return _applyQueue;
}

// POST /api/apply/enqueue
// Body: { jobUrl, jobTitle, company, jobDescription, dryRun? }
router.post('/enqueue', requireAuth, async (req, res) => {
  const { jobUrl, jobTitle, company, jobDescription, dryRun = false } = req.body;
  if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });

  // Fetch user profile
  const profileResult = await db.query(
    `SELECT autofill_data FROM user_profile WHERE user_id = $1 LIMIT 1`,
    [req.user.id]
  );
  const profile = profileResult.rows[0]?.autofill_data;
  if (!profile || Object.keys(profile).length === 0) return res.status(400).json({ error: 'No profile found — complete your profile first' });

  // Insert job_application row
  const appResult = await db.query(
    `INSERT INTO job_applications (user_id, job_url, job_title, company, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'queued', NOW(), NOW())
     RETURNING id`,
    [req.user.id, jobUrl, jobTitle || null, company || null]
  );
  const applicationId = appResult.rows[0].id;

  const queue = getApplyQueue();
  if (!queue) {
    return res.status(503).json({ error: 'Apply queue not available (Redis not configured)' });
  }

  await queue.add('apply', {
    applicationId,
    jobUrl,
    profile,
    jobDescription: jobDescription || '',
    dryRun,
  });

  res.json({ ok: true, applicationId });
});

// GET /api/apply/status/:id
router.get('/status/:id', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, job_url, job_title, company, status, filled_fields, skipped_fields,
            errored_fields, field_count, ai_used, ai_fields, error, screenshot_b64,
            created_at, updated_at
     FROM job_applications
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

// GET /api/apply/list
router.get('/list', requireAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, job_url, job_title, company, status, filled_fields, field_count,
            ai_used, created_at, updated_at
     FROM job_applications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
});

export default router;
