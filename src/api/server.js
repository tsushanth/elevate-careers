import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import pinoHttp from 'pino-http';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { enqueueJob } from '../services/queue.js';
import { createClient } from '@supabase/supabase-js';

import { recomputeSignals } from '../services/signals.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _supabase;
}

const app = express();

// CORS must run before helmet so preflight OPTIONS are answered before
// helmet's restrictive headers (cross-origin-resource-policy: same-origin)
// can block cross-origin requests from job board domains.
const corsOptions = {
  origin: true,          // reflect requesting origin
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // explicit preflight handler

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow extension fetches
  crossOriginOpenerPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));

// Health check
app.get('/health', async (req, res) => {
  const dbHealthy = await db.healthCheck();
  
  if (dbHealthy) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

import aiResumeRoutes from '../routes/ai-resume.js';
app.use('/api/ai-resume', aiResumeRoutes);

// Sync ingestion — responds immediately, processes in background
app.post('/ingest/sync', async (req, res) => {
  try {
    const { provider, org, secret } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });
    if (!provider || !org) return res.status(400).json({ error: 'provider and org required' });
    res.json({ ok: true, org, provider, status: 'processing' });
    // Process after response to avoid Fly's 30s request timeout
    setImmediate(async () => {
      try {
        const getAdapter = (await import('../adapters/index.js')).default;
        const normalizer = (await import('../services/normalizer.js')).default;
        const adapter = getAdapter(provider);
        const rawJobs = await adapter.fetchJobs(org);
        const results = await normalizer.processJobs(rawJobs, provider, org);
        logger.info({ org, provider, fetched: rawJobs.length, ...results }, 'Sync ingest complete');
      } catch (e) {
        logger.error({ error: e, org, provider }, 'Sync ingest background error');
      }
    });
  } catch (e) {
    logger.error({ error: e }, 'Sync ingest error');
    res.status(500).json({ error: e.message });
  }
});

// Ingestion API
app.post('/ingest/org', async (req, res) => {
  try {
    const { provider, org } = req.body;
    
    if (!provider || !org) {
      return res.status(400).json({ 
        error: 'Missing required fields: provider, org' 
      });
    }
    
    // Validate provider
    const validProviders = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];
    if (!validProviders.includes(provider.toLowerCase())) {
      return res.status(400).json({ 
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` 
      });
    }
    
    // Enqueue job with timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Queue operation timeout')), 5000)
    );
    
    const job = await Promise.race([
      enqueueJob('fetch-jobs', { provider, org }),
      timeoutPromise
    ]);
    
    // Check if queue is available
    if (job.id === 'no-queue') {
      return res.status(503).json({
        message: 'Job queue not configured',
        note: 'Redis and Worker must be set up to process job ingestion',
        provider,
        org,
        setup_required: {
          redis: 'Configure Redis connection',
          worker: 'Deploy worker service'
        }
      });
    }
    
    res.json({
      message: 'Job enqueued successfully',
      jobId: job.id,
      provider,
      org,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Ingestion API error');
    
    if (error.message === 'Queue operation timeout') {
      return res.status(503).json({ 
        error: 'Queue service unavailable',
        message: 'Job queue is not configured. Set up Redis + Worker to enable job ingestion.'
      });
    }
    
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

app.post('/ingest/discover', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'Missing required field: url' 
      });
    }
    
    // Enqueue JSON-LD discovery job with timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Queue operation timeout')), 5000)
    );
    
    const job = await Promise.race([
      enqueueJob('discover-jobs', { provider: 'jsonld', url }),
      timeoutPromise
    ]);
    
    // Check if queue is available
    if (job.id === 'no-queue') {
      return res.status(503).json({
        message: 'Job queue not configured',
        note: 'Redis and Worker must be set up to process job discovery',
        url,
        setup_required: {
          redis: 'Configure Redis connection',
          worker: 'Deploy worker service'
        }
      });
    }
    
    res.json({
      message: 'Discovery job enqueued successfully',
      jobId: job.id,
      url,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Discovery API error');
    
    if (error.message === 'Queue operation timeout') {
      return res.status(503).json({ 
        error: 'Queue service unavailable',
        message: 'Job queue is not configured. Set up Redis + Worker to enable job discovery.'
      });
    }
    
    res.status(500).json({ error: 'Failed to enqueue discovery job' });
  }
});

// Jobs API
app.get('/jobs/personalized', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    const sb = getSupabase();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const { limit = 50, offset = 0, show_applied = 'false' } = req.query;
    const hideApplied = show_applied !== 'true';

    // Fetch applied job URLs for this user to exclude them
    const { data: appliedRows } = await sb.from('job_applications')
      .select('job_url')
      .eq('user_id', user.id);
    const appliedUrls = (appliedRows || []).map(r => r.job_url).filter(Boolean);
    const appliedCount = appliedUrls.length;

    // Build exclusion clause
    const excludeClause = hideApplied && appliedUrls.length > 0
      ? `AND j.apply_url NOT IN (${appliedUrls.map((_, i) => `$${i + 4}`).join(',')})`
      : '';

    // Read precomputed signals — fast single row lookup
    const { data: signals } = await sb.from('user_signals')
      .select('keywords, preferred_titles')
      .eq('user_id', user.id)
      .single();

    const keywords = signals?.keywords || [];
    let jobs = [];

    if (keywords.length > 0) {
      const safeKeywords = keywords.filter(k => /^[a-z0-9]+$/i.test(k));
      if (safeKeywords.length > 0) {
        const tsQuery = safeKeywords.join(' | ');
        const extraParams = hideApplied ? appliedUrls : [];
        const result = await db.query(`
          SELECT
            j.*,
            c.name as company_name,
            c.domain as company_domain,
            array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
            array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries,
            ts_rank(j.tsv, to_tsquery('english', $1)) as relevance
          FROM job j
          JOIN company c ON j.company_id = c.id
          LEFT JOIN job_location jl ON j.id = jl.job_id
          WHERE j.tsv @@ to_tsquery('english', $1)
          ${excludeClause}
          GROUP BY j.id, c.name, c.domain
          ORDER BY relevance DESC, j.posted_at DESC NULLS LAST
          LIMIT $2 OFFSET $3
        `, [tsQuery, limit, offset, ...extraParams]);
        jobs = result.rows;
      }
    }

    // Fall back to recent jobs if no signals yet or too few results
    if (jobs.length < 10) {
      const extraParams = hideApplied ? appliedUrls : [];
      const fallbackExclude = hideApplied && appliedUrls.length > 0
        ? `AND j.apply_url NOT IN (${appliedUrls.map((_, i) => `$${i + 3}`).join(',')})`
        : '';
      const result = await db.query(`
        SELECT j.*, c.name as company_name, c.domain as company_domain,
          array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
          array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
        FROM job j
        JOIN company c ON j.company_id = c.id
        LEFT JOIN job_location jl ON j.id = jl.job_id
        WHERE 1=1 ${fallbackExclude}
        GROUP BY j.id, c.name, c.domain
        ORDER BY j.posted_at DESC NULLS LAST
        LIMIT $1 OFFSET $2
      `, [limit, offset, ...extraParams]);
      jobs = result.rows;
    }

    res.json({ jobs, count: jobs.length, keywords, appliedCount, offset: parseInt(offset), limit: parseInt(limit) });
  } catch (e) {
    logger.error({ error: e }, 'Personalized jobs error');
    res.status(500).json({ error: 'Failed to fetch personalized jobs' });
  }
});

app.get('/jobs', async (req, res) => {
  try {
    const {
      keyword,
      location,
      remote,
      company,
      posted_since,
      employment_type,
      salary_min,
      limit = 50,
      offset = 0,
    } = req.query;
    
    let query = `
      SELECT 
        j.*,
        c.name as company_name,
        c.domain as company_domain,
        array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
        array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
      FROM job j
      JOIN company c ON j.company_id = c.id
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (keyword) {
      paramCount++;
      query += ` AND j.tsv @@ plainto_tsquery('english', $${paramCount})`;
      params.push(keyword);
    }
    
    if (location) {
      paramCount++;
      query += ` AND EXISTS (
        SELECT 1 FROM job_location 
        WHERE job_id = j.id 
        AND (city ILIKE $${paramCount} OR region ILIKE $${paramCount} OR country ILIKE $${paramCount})
      )`;
      params.push(`%${location}%`);
    }
    
    if (remote === 'true') {
      query += ` AND j.remote = true`;
    }
    
    if (company) {
      paramCount++;
      query += ` AND c.name ILIKE $${paramCount}`;
      params.push(`%${company}%`);
    }
    
    if (posted_since) {
      paramCount++;
      query += ` AND j.posted_at >= $${paramCount}`;
      params.push(posted_since);
    }
    
    if (employment_type) {
      paramCount++;
      query += ` AND j.employment_type = $${paramCount}`;
      params.push(employment_type);
    }
    
    if (salary_min) {
      paramCount++;
      query += ` AND j.salary_min >= $${paramCount}`;
      params.push(salary_min);
    }
    
    query += ` GROUP BY j.id, c.name, c.domain`;
    query += ` ORDER BY j.posted_at DESC NULLS LAST`;
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);
    
    const result = await db.query(query, params);
    
    res.json({
      jobs: result.rows,
      count: result.rows.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error({ error }, 'Jobs API error');
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get single job
app.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT 
        j.*,
        c.name as company_name,
        c.domain as company_domain,
        jv.description_md,
        jv.skills,
        array_agg(json_build_object(
          'city', jl.city,
          'region', jl.region,
          'country', jl.country,
          'remote', jl.remote
        )) FILTER (WHERE jl.id IS NOT NULL) as locations
      FROM job j
      JOIN company c ON j.company_id = c.id
      LEFT JOIN job_version jv ON j.current_version_id = jv.id
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name, c.domain, jv.description_md, jv.skills
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error({ error }, 'Job detail API error');
    res.status(500).json({ error: 'Failed to fetch job details' });
  }
});

// Saved searches
app.post('/saved-searches', async (req, res) => {
  try {
    const { user_id, query, frequency } = req.body;
    
    if (!user_id || !query || !frequency) {
      return res.status(400).json({ 
        error: 'Missing required fields: user_id, query, frequency' 
      });
    }
    
    const result = await db.query(`
      INSERT INTO saved_search (user_id, query, frequency)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [user_id, JSON.stringify(query), frequency]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error({ error }, 'Saved search API error');
    res.status(500).json({ error: 'Failed to create saved search' });
  }
});

app.get('/saved-searches/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const result = await db.query(
      'SELECT * FROM saved_search WHERE user_id = $1 ORDER BY id DESC',
      [user_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Saved search fetch API error');
    res.status(500).json({ error: 'Failed to fetch saved searches' });
  }
});

// Applications (tracker)
app.post('/applications', async (req, res) => {
  try {
    const { user_id, job_id, status, notes, resume_variant } = req.body;
    
    if (!user_id || !job_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: user_id, job_id' 
      });
    }
    
    const result = await db.query(`
      INSERT INTO application (user_id, job_id, status, notes, resume_variant)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [user_id, job_id, status || 'saved', notes, resume_variant]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error({ error }, 'Application API error');
    res.status(500).json({ error: 'Failed to create application' });
  }
});

app.get('/applications/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status } = req.query;
    
    let query = `
      SELECT 
        a.*,
        j.title as job_title,
        j.apply_url,
        c.name as company_name
      FROM application a
      JOIN job j ON a.job_id = j.id
      JOIN company c ON j.company_id = c.id
      WHERE a.user_id = $1
    `;
    
    const params = [user_id];
    
    if (status) {
      query += ` AND a.status = $2`;
      params.push(status);
    }
    
    query += ` ORDER BY a.created_at DESC`;
    
    const result = await db.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Application fetch API error');
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

app.patch('/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, next_action_at } = req.body;
    
    const result = await db.query(`
      UPDATE application 
      SET 
        status = COALESCE($1, status),
        notes = COALESCE($2, notes),
        next_action_at = COALESCE($3, next_action_at)
      WHERE id = $4
      RETURNING *
    `, [status, notes, next_action_at, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error({ error }, 'Application update API error');
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;