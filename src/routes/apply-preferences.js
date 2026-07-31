import express from 'express';
import { Queue } from 'bullmq';
import { connection } from '../services/queue.js';
import { db } from '../db/index.js';
import { createClient } from '@supabase/supabase-js';
import { resolveJobIdForUrl } from '../services/jobIdentity.js';
import { normalizeCompanyName } from '../services/normalizer.js';

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
  } catch {
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

// GET /api/preferences — return current user preferences (or defaults)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT keywords, remote, location, salary_min, excluded_companies, daily_limit, enabled, auto_apply_similar
       FROM apply_preferences WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.json({ keywords: [], remote: false, location: '', salary_min: null, excluded_companies: [], daily_limit: 10, enabled: false, auto_apply_similar: false });
    }
    res.json(result.rows[0]);
  } catch (e) {
    console.error('[prefs GET]', e);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});

// POST /api/preferences — upsert user preferences
router.post('/', requireAuth, async (req, res) => {
  const { keywords = [], remote = false, location = '', salary_min = null, excluded_companies = [], daily_limit = 10, enabled = false, auto_apply_similar = false } = req.body;
  try {
    await db.query(
      `INSERT INTO apply_preferences (user_id, keywords, remote, location, salary_min, excluded_companies, daily_limit, enabled, auto_apply_similar, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         keywords=$2, remote=$3, location=$4, salary_min=$5,
         excluded_companies=$6, daily_limit=$7, enabled=$8, auto_apply_similar=$9, updated_at=NOW()`,
      [req.user.id, keywords, remote, location || null, salary_min || null, excluded_companies, daily_limit, enabled, auto_apply_similar]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[prefs POST]', e);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// GET /api/preferences/suggested — return suggested jobs based on past application titles
router.get('/suggested', requireAuth, async (req, res) => {
  try {
    // Get last 30 applied job titles
    const titlesResult = await db.query(
      `SELECT job_title FROM job_applications WHERE user_id=$1 AND job_title IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );

    // Get user preferences for filters + explicit keywords
    const prefsResult = await db.query(
      `SELECT remote, salary_min, location, excluded_companies, keywords FROM apply_preferences WHERE user_id=$1 LIMIT 1`,
      [req.user.id]
    );
    const prefs = prefsResult.rows[0] || {};

    // Use explicit preference keywords if set, otherwise derive from applied job titles
    let keywords = (prefs.keywords || []).filter(k => k.length > 0);
    if (keywords.length === 0) {
      const allWords = titlesResult.rows.flatMap(r => r.job_title.split(/\s+/));
      keywords = [...new Set(
        allWords.filter(w => w.length > 3 && /^[a-z0-9#+.\-]+$/i.test(w))
      )].slice(0, 15);
    }

    if (keywords.length === 0) return res.json({ jobs: [], keywords: [] });

    // Get already-applied jobs — prefer job_id (stable) over job_url
    // (drifts on re-ingestion), same reasoning as /jobs/personalized.
    const appliedResult = await db.query(
      `SELECT job_id, job_url FROM job_applications WHERE user_id=$1`,
      [req.user.id]
    );
    const appliedJobIds = appliedResult.rows.map(r => r.job_id).filter(Boolean);
    const appliedUrls = appliedResult.rows.filter(r => !r.job_id).map(r => r.job_url).filter(Boolean);

    const tsQuery = keywords.join(' | ');
    let jobQuery = `
      SELECT j.id, j.apply_url, j.title, j.remote, j.salary_min, j.salary_max, j.posted_at,
             c.name as company_name, c.domain as company_domain,
             array_agg(json_build_object('city', jl.city, 'region', jl.region, 'country', jl.country)) FILTER (WHERE jl.id IS NOT NULL) as locations,
             ts_rank(j.tsv, to_tsquery('english', $1)) as ts_rank
      FROM job j
      JOIN company c ON j.company_id = c.id
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE j.tsv @@ to_tsquery('english', $1)
        AND j.posted_at >= NOW() - INTERVAL '14 days'
    `;
    const queryParams = [tsQuery];
    let pidx = 2;

    if (appliedJobIds.length) {
      jobQuery += ` AND j.id != ALL($${pidx}::bigint[])`;
      queryParams.push(appliedJobIds);
      pidx++;
    }
    if (appliedUrls.length) {
      // Compare with query string + trailing slash stripped — the extension
      // appends tracking params (e.g. ?gh_src=...) when a user applies, which
      // would defeat an exact-string match against the ingested apply_url.
      // Fallback only, for legacy rows with no job_id (see jobIdentity.js).
      jobQuery += ` AND NOT EXISTS (
        SELECT 1 FROM unnest($${pidx}::text[]) au(url)
        WHERE rtrim(split_part(j.apply_url, '?', 1), '/') = rtrim(split_part(au.url, '?', 1), '/')
      )`;
      queryParams.push(appliedUrls);
      pidx += 1;
    }
    if (prefs.remote) jobQuery += ` AND j.remote = true`;
    if (prefs.salary_min) { jobQuery += ` AND (j.salary_min IS NULL OR j.salary_min >= $${pidx})`; queryParams.push(prefs.salary_min); pidx++; }
    if ((prefs.excluded_companies || []).length) {
      jobQuery += ` AND c.name_normalized != ALL($${pidx}::text[])`;
      queryParams.push(prefs.excluded_companies.map(normalizeCompanyName));
      pidx++;
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    jobQuery += ` GROUP BY j.id, c.name, c.domain ORDER BY ts_rank DESC, j.posted_at DESC LIMIT $${pidx} OFFSET $${pidx + 1}`;
    queryParams.push(limit, offset);

    const jobsResult = await db.query(jobQuery, queryParams);
    res.json({ jobs: jobsResult.rows, keywords, hasMore: jobsResult.rows.length === limit });
  } catch (e) {
    console.error('[prefs suggested]', e);
    res.status(500).json({ error: 'Failed to fetch suggested jobs' });
  }
});

// POST /api/preferences/seed — called when user clicks "Auto Apply" on a job card
// Seeds preferences from the job, optionally enqueues the specific job immediately
router.post('/seed', requireAuth, async (req, res) => {
  const { jobUrl, jobTitle, company, jobDescription, skills = [] } = req.body;
  if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });

  // Keep the job title as one phrase (not split into loose words) so downstream
  // tsquery AND-within-phrase matching stays specific instead of OR-ing bare
  // words like "engineer" or "learning" against every job in the corpus.
  const cleanTitle = (jobTitle || '').trim();
  const newKeywords = [...new Set([cleanTitle, ...skills])].filter(Boolean).slice(0, 10);

  try {
    // Only seed preferences if the user has none yet
    const existing = await db.query(
      `SELECT user_id FROM apply_preferences WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!existing.rows.length) {
      await db.query(
        `INSERT INTO apply_preferences (user_id, keywords, enabled, updated_at)
         VALUES ($1,$2,true,NOW())`,
        [req.user.id, newKeywords]
      );
    }

    // Fetch profile so we can enqueue immediately
    const profileResult = await db.query(
      `SELECT autofill_data FROM user_profile WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    const profile = profileResult.rows[0]?.autofill_data;
    if (!profile || Object.keys(profile).length === 0) {
      // Preferences saved but can't enqueue — no profile
      return res.json({ ok: true, queued: false, reason: 'no_profile' });
    }

    const jobId = await resolveJobIdForUrl(jobUrl);
    const appResult = await db.query(
      `INSERT INTO job_applications (user_id, job_url, job_title, company, job_id, status, auto_applied, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'queued',true,NOW(),NOW())
       RETURNING id`,
      [req.user.id, jobUrl, jobTitle || null, company || null, jobId]
    );
    const applicationId = appResult.rows[0].id;

    const queue = getApplyQueue();
    if (queue) {
      await queue.add('apply', {
        applicationId,
        jobUrl,
        profile,
        jobDescription: jobDescription || '',
        dryRun: false,
      });
    }

    res.json({ ok: true, queued: true, applicationId });
  } catch (e) {
    console.error('[prefs seed]', e);
    res.status(500).json({ error: 'Failed to seed preferences' });
  }
});

export default router;
