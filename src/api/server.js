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
import { normalizeCompanyName, normalizeTitle, companySlug } from '../services/normalizer.js';
import { REGION_CODES, nonUsTitleRegex, resolveLocationToken } from '../services/geo.js';
import Anthropic from '@anthropic-ai/sdk';

const NON_US_REGION_CODES_SQL = REGION_CODES.join('|');
const NON_US_TITLE_REGEX_SQL = nonUsTitleRegex();

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", 'https://owvvrljdfnhntwedepkl.supabase.co'],
      connectSrc: ["'self'", 'https://owvvrljdfnhntwedepkl.supabase.co', 'wss://owvvrljdfnhntwedepkl.supabase.co', 'https://elevate-careers-api.fly.dev'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
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

import repairRoutes from '../routes/repair.js';
app.use('/api/repair', repairRoutes);

import applyRoutes from '../routes/apply.js';
app.use('/api/apply', applyRoutes);

import applyPreferencesRoutes from '../routes/apply-preferences.js';
app.use('/api/preferences', applyPreferencesRoutes);

// Fetch GitHub ATS datasets and populate discovered_company table
app.post('/ingest/bootstrap-discovery', async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    res.json({ ok: true, status: 'bootstrapping in background' });

    setImmediate(async () => {
      let total = 0;
      const CHUNK = 500;

      // Batch-insert helper: one multi-row INSERT per chunk instead of one
      // query per row. With ~20K+ rows across all sources combined, one-row-
      // at-a-time (~90ms/row observed) took 60-90+ minutes — long enough that
      // the cron script's fixed wait before starting ingestion ran out before
      // discovery actually finished. Chunked inserts bring this down to seconds.
      async function batchUpsert(rows, { withName }) {
        // A single INSERT...ON CONFLICT can't target the same (provider, org)
        // twice — dedupe first in case a source lists the same company twice.
        const seen = new Set();
        const deduped = rows.filter(r => {
          const key = `${r[0]}:${r[1]}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        for (let i = 0; i < deduped.length; i += CHUNK) {
          const chunk = deduped.slice(i, i + CHUNK);
          const cols = withName ? 4 : 3;
          const values = [];
          const placeholders = chunk.map((row, j) => {
            const base = j * cols;
            values.push(...row);
            return withName
              ? `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`
              : `($${base + 1}, $${base + 2}, $${base + 3})`;
          }).join(', ');
          const sql = withName
            ? `INSERT INTO discovered_company (provider, org, name, source) VALUES ${placeholders}
               ON CONFLICT (provider, org) DO UPDATE SET name = COALESCE(discovered_company.name, EXCLUDED.name)`
            : `INSERT INTO discovered_company (provider, org, source) VALUES ${placeholders}
               ON CONFLICT (provider, org) DO NOTHING`;
          await db.query(sql, values);
          total += chunk.length;
        }
      }

      // Source 1: kalil0321/ats-scrapers — CSV with name,slug,url (clean, named)
      const kalilPlatforms = {
        greenhouse: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/greenhouse.csv',
        lever: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/lever.csv',
        ashby: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/ashby.csv',
        smartrecruiters: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/smartrecruiters.csv',
        workable: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/workable.csv',
        bamboohr: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/bamboohr.csv',
        recruitee: 'https://raw.githubusercontent.com/kalil0321/ats-scrapers/main/ats-companies/recruitee.csv',
      };
      for (const [provider, url] of Object.entries(kalilPlatforms)) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const text = await resp.text();
          const lines = text.trim().split('\n').slice(1); // skip header
          const rows = [];
          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length < 2) continue;
            const name = parts[0].trim().replace(/^"|"$/g, '');
            const org = parts[1].trim().replace(/^"|"$/g, '').toLowerCase();
            if (!org) continue;
            rows.push([provider, org, name, 'github_kalil']);
          }
          await batchUpsert(rows, { withName: true });
          logger.info({ provider, source: 'github_kalil', count: rows.length }, 'Bootstrap CSV loaded');
        } catch (e) {
          logger.error({ error: e.message, provider, url }, 'Bootstrap CSV error');
        }
      }

      // Source 2: Feashliaa/job-board-aggregator — JSON arrays of slugs (larger, noisier)
      const feashliaaUrls = {
        greenhouse: 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/greenhouse_companies.json',
        lever: 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/lever_companies.json',
        ashby: 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/ashby_companies.json',
      };
      for (const [provider, url] of Object.entries(feashliaaUrls)) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const slugs = await resp.json();
          const rows = [];
          for (const slug of slugs) {
            const org = String(slug).toLowerCase().trim();
            // Skip noise: purely numeric IDs or very short slugs
            if (!org || /^\d+$/.test(org) || org.length < 2) continue;
            rows.push([provider, org, 'github_feashliaa']);
          }
          await batchUpsert(rows, { withName: false });
          logger.info({ provider, source: 'github_feashliaa', count: rows.length }, 'Bootstrap JSON loaded');
        } catch (e) {
          logger.error({ error: e.message, provider, url }, 'Bootstrap JSON error');
        }
      }

      logger.info({ total }, 'Bootstrap discovery complete');
    });
  } catch (e) {
    logger.error({ error: e }, 'Bootstrap discovery error');
    res.status(500).json({ error: e.message });
  }
});

// One-time-ish backfill: resolve logo_domain for existing companies that
// don't have one yet (created before this column existed). Rate-limited
// loop against Clearbit's free autocomplete endpoint.
// One-off: recompute tsv for all existing rows with title weighted far above
// description ('A' vs 'D' — see normalizer.js's createJob/updateJob comment).
// Only new/updated jobs pick up the new weighting automatically; this
// backfills everything already ingested before that change, so the fix is
// immediate instead of waiting for organic re-ingestion to touch each row.
app.post('/ingest/backfill-tsv-weights', async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    const result = await db.query(`
      UPDATE job SET tsv =
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', COALESCE(description_excerpt, '')), 'D')
    `);

    logger.info({ updated: result.rowCount }, 'tsv weight backfill complete');
    res.json({ ok: true, updated: result.rowCount });
  } catch (e) {
    logger.error({ error: e.message }, 'tsv weight backfill failed');
    res.status(500).json({ error: e.message });
  }
});

app.post('/ingest/backfill-logos', async (req, res) => {
  try {
    const { secret, limit = 500 } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    const { rows } = await db.query(
      `SELECT id, name FROM company WHERE logo_domain IS NULL ORDER BY id LIMIT $1`,
      [limit]
    );
    res.json({ ok: true, queued: rows.length });

    setImmediate(async () => {
      const { resolveLogoDomain } = await import('../services/normalizer.js');
      let updated = 0;
      for (const company of rows) {
        try {
          const logoDomain = await resolveLogoDomain(company.name);
          if (logoDomain) {
            await db.query('UPDATE company SET logo_domain = $1 WHERE id = $2', [logoDomain, company.id]);
            updated++;
          } else {
            // Mark attempted with a sentinel so it isn't retried every run —
            // NULL specifically means "not looked up yet".
            await db.query(`UPDATE company SET logo_domain = '' WHERE id = $1`, [company.id]);
          }
        } catch (e) {
          logger.warn({ error: e.message, company: company.name }, 'Backfill logo lookup failed');
        }
        await new Promise(r => setTimeout(r, 300));
      }
      logger.info({ total: rows.length, updated }, 'Logo backfill complete');
    });
  } catch (e) {
    logger.error({ error: e }, 'Logo backfill error');
    res.status(500).json({ error: e.message });
  }
});

// Extension-reported org discovery — called when extension sees a supported ATS job page
app.post('/ingest/report-org', async (req, res) => {
  try {
    const { provider, org } = req.body;
    if (!provider || !org) return res.status(400).json({ error: 'provider and org required' });
    const validProviders = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];
    if (!validProviders.includes(provider)) return res.status(400).json({ error: 'invalid provider' });
    const cleanOrg = String(org).toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (!cleanOrg || cleanOrg.length < 2) return res.status(400).json({ error: 'invalid org' });

    await db.query(
      `INSERT INTO discovered_company (provider, org, source)
       VALUES ($1, $2, 'extension')
       ON CONFLICT (provider, org) DO NOTHING`,
      [provider, cleanOrg]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.error({ error: e }, 'Report-org error');
    res.status(500).json({ error: e.message });
  }
});

// Read-only queue listing for the cron machine to drive its own ingestion
// loop. Ingestion iteration used to live here on the API as a fire-and-forget
// setImmediate loop, which meant every unrelated API deploy killed it mid-run
// — only 35 of 5,126 discovered companies had ever actually been attempted.
// Moving the loop to the persistent cron machine (which API deploys don't
// touch) fixes that; this endpoint just hands it the ordered work list.
app.get('/ingest/queue', async (req, res) => {
  try {
    const { secret, limit = 6000 } = req.query;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });
    const { rows } = await db.query(
      `SELECT provider, org FROM discovered_company WHERE enabled = true ORDER BY last_ingested_at ASC NULLS FIRST LIMIT $1`,
      [limit]
    );
    res.json({ ok: true, companies: rows });
  } catch (e) {
    logger.error({ error: e }, 'Ingest queue error');
    res.status(500).json({ error: e.message });
  }
});

// Sync all companies — from discovered_company table + companies.json fallback
app.post('/ingest/sync-all', async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    // Pull from discovered_company table first, fall back to companies.json
    let tasks = [];
    try {
      const { rows } = await db.query(
        `SELECT provider, org FROM discovered_company WHERE enabled = true ORDER BY last_ingested_at ASC NULLS FIRST`
      );
      tasks = rows;
    } catch (e) {
      logger.warn('discovered_company table not available, falling back to companies.json');
    }

    if (tasks.length === 0) {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const companies = require('../../companies.json');
      for (const [provider, orgs] of Object.entries(companies)) {
        for (const org of orgs) tasks.push({ provider, org });
      }
    }

    res.json({ ok: true, queued: tasks.length });

    setImmediate(async () => {
      const getAdapter = (await import('../adapters/index.js')).default;
      const normalizer = (await import('../services/normalizer.js')).default;
      for (const { provider, org } of tasks) {
        try {
          const adapter = getAdapter(provider);
          const rawJobs = await adapter.fetchJobs(org);
          const results = await normalizer.processJobs(rawJobs, provider, org);
          await db.query(
            `UPDATE discovered_company SET last_ingested_at = now() WHERE provider = $1 AND org = $2`,
            [provider, org]
          ).catch(() => {});
          logger.info({ org, provider, fetched: rawJobs.length, ...results }, 'Sync-all ingest complete');
        } catch (e) {
          logger.error({ error: e.message, org, provider }, 'Sync-all ingest error');
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      logger.info({ total: tasks.length }, 'Sync-all ingestion run complete');
    });
  } catch (e) {
    logger.error({ error: e }, 'Sync-all error');
    res.status(500).json({ error: e.message });
  }
});

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
        await db.query(
          `UPDATE discovered_company SET last_ingested_at = now() WHERE provider = $1 AND org = $2`,
          [provider, org]
        ).catch(() => {});
        logger.info({ org, provider, fetched: rawJobs.length, ...results }, 'Sync ingest complete');
      } catch (e) {
        // Still mark as attempted so a permanently-broken org doesn't block
        // the front of the queue forever — it'll be retried, just not first.
        await db.query(
          `UPDATE discovered_company SET last_ingested_at = now() WHERE provider = $1 AND org = $2`,
          [provider, org]
        ).catch(() => {});
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

// JobSpy ingest — called by cron after ATS sync
app.post('/ingest/jobspy', async (req, res) => {
  try {
    const { secret, queries, max_results = 50, sites } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    const jobspyUrl = process.env.JOBSPY_URL || 'https://elevate-careers-jobspy.fly.dev';
    const jobspySecret = process.env.JOBSPY_SECRET || '';

    // Kick off scrape on Python service
    const scrapeRes = await fetch(`${jobspyUrl}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jobspySecret ? { Authorization: `Bearer ${jobspySecret}` } : {}),
      },
      body: JSON.stringify({ queries, max_results, sites }),
      signal: AbortSignal.timeout(110_000),
    });

    if (!scrapeRes.ok) {
      const err = await scrapeRes.text();
      return res.status(502).json({ error: 'jobspy service error', detail: err });
    }

    const { jobs: rawJobs } = await scrapeRes.json();
    logger.info({ count: rawJobs.length }, 'jobspy scrape returned');

    const normalizer = (await import('../services/normalizer.js')).default;
    let created = 0, skipped = 0, errors = 0;

    for (const j of rawJobs) {
      try {
        if (!j.title || !j.apply_url || !j.company) { skipped++; continue; }

        // Build a slug domain from company name for deduplication — must use
        // the same normalization as company matching (see companySlug's doc
        // comment in normalizer.js) or minor source variation in the
        // company-name string creates duplicate job rows for one posting.
        const slug = companySlug(j.company);
        const companyDomain = `${slug}.jobspy`;

        const normalized = {
          provider:    j.source || 'jobspy',
          external_id: j.external_id || null,
          apply_url:   j.apply_url,
          title:       j.title,
          description: j.description || '',
          employment_type: j.job_type || null,
          remote:      j.remote || false,
          salary_min:  j.salary_min || null,
          salary_max:  j.salary_max || null,
          salary_currency: j.currency || 'USD',
          posted_at:   j.posted_at || null,
          company_domain: companyDomain,
          location:    j.location || null,
        };

        await normalizer.processJob(normalized, normalized.provider, slug);
        created++;
      } catch (e) {
        logger.warn({ error: e.message, title: j.title }, 'jobspy job ingest error');
        errors++;
      }
    }

    logger.info({ created, skipped, errors }, 'jobspy ingest complete');
    res.json({ ok: true, created, skipped, errors, total: rawJobs.length });
  } catch (e) {
    logger.error({ error: e.message }, 'jobspy ingest failed');
    res.status(500).json({ error: e.message });
  }
});

// LinkedIn ingest — jobs are scraped and posted directly by aihawk-local's
// read-only search (src/ai_hawk/job_manager.py), not fetched by this server.
// Reuses the same shared-secret auth + normalizer.processJob() pattern as
// /ingest/jobspy above rather than inventing a new ingestion path.
app.post('/ingest/linkedin', async (req, res) => {
  try {
    const { secret, jobs: rawJobs } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });
    if (!Array.isArray(rawJobs)) return res.status(400).json({ error: 'jobs must be an array' });

    logger.info({ count: rawJobs.length }, 'linkedin ingest received');

    const normalizer = (await import('../services/normalizer.js')).default;
    let created = 0, skipped = 0, errors = 0;

    for (const j of rawJobs) {
      try {
        if (!j.title || !j.apply_url || !j.company) { skipped++; continue; }

        const slug = companySlug(j.company);
        const companyDomain = `${slug}.linkedin`;

        const normalized = {
          provider: 'linkedin',
          external_id: j.external_id || null,
          apply_url: j.apply_url,
          title: j.title,
          description: j.description || '',
          employment_type: null,
          remote: null,
          salary_min: null,
          salary_max: null,
          salary_currency: 'USD',
          // aihawk-local's scraper doesn't capture LinkedIn's own posted-date
          // text, unlike the JobSpy path (which gets a real date_posted from
          // the library). /jobs sorts ORDER BY posted_at DESC NULLS LAST, so
          // leaving this null means every LinkedIn job ingested here sorts to
          // the absolute bottom of every search result, permanently -- found
          // this via a live site test where a confirmed top-keyword-match job
          // never appeared in the visible results. Ingestion time is a
          // reasonable proxy (better than making the job invisible) until the
          // scraper is extended to parse LinkedIn's relative-time card text.
          posted_at: new Date().toISOString(),
          company_domain: companyDomain,
          location: j.location || null,
        };

        await normalizer.processJob(normalized, normalized.provider, slug);
        created++;
      } catch (e) {
        logger.warn({ error: e.message, title: j.title }, 'linkedin job ingest error');
        errors++;
      }
    }

    logger.info({ created, skipped, errors }, 'linkedin ingest complete');
    res.json({ ok: true, created, skipped, errors, total: rawJobs.length });
  } catch (e) {
    logger.error({ error: e.message }, 'linkedin ingest failed');
    res.status(500).json({ error: e.message });
  }
});

// Deterministic companion to /ingest/classify-locations below: geo.js's
// dictionaries grow over time (a city gets added after being hand-traced
// from a user report, or picked up from an audit), but only NEW/updated
// job rows automatically pick up a dictionary addition — existing rows
// stay stuck with the country/region they had at ingestion time forever,
// even once the code already knows the answer. Confirmed needed: "vilnius"
// has been in CITY_COUNTRY for a while, but a job ingested before that
// still had country=NULL until this route ran. Zero AI calls, exact
// matches only — safe to run as often as wanted. HTTP port of
// scripts/backfill-job-locations.js --apply, so both stay in sync.
app.post('/ingest/backfill-known-locations', async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    const { rows } = await db.query(`
      SELECT id, city FROM job_location
      WHERE region IS NULL AND country IS NULL AND city IS NOT NULL
    `);

    let updated = 0;
    for (const r of rows) {
      const match = resolveLocationToken(r.city);
      if (!match) continue;
      if (match.type === 'country') {
        await db.query(`UPDATE job_location SET country = $1, city = NULL WHERE id = $2`, [match.value, r.id]);
      } else if (match.type === 'region') {
        await db.query(`UPDATE job_location SET region = $1, city = NULL WHERE id = $2`, [match.value, r.id]);
      } else {
        await db.query(`UPDATE job_location SET city = $1, country = $2 WHERE id = $3`, [match.value, match.country, r.id]);
      }
      updated++;
    }

    logger.info({ checked: rows.length, updated }, 'known-locations backfill complete');
    res.json({ ok: true, checked: rows.length, updated });
  } catch (e) {
    logger.error({ error: e.message }, 'backfill-known-locations failed');
    res.status(500).json({ error: e.message });
  }
});

// Self-healing location resolution — closes the gap that used to require a
// human spotting a leaked non-US job in the feed, then a Claude session
// tracing the raw string and hand-patching geo.js. Every raw location
// string geo.js's static dictionaries can't resolve (city set, country/
// region both null) leaves that job's country UNKNOWN, which the US-only
// feed filter treats as "don't over-exclude" — permissive by design for
// genuinely ambiguous data, but it means every new unrecognized city name
// (Czechia, Hobart, Mississauga, "Santiago de los Caballeros"... all found
// by hand this way) silently shows up in a US candidate's feed until
// someone notices and fixes it. This route asks an AI model to classify the
// highest-volume unresolved strings and writes the result straight into
// job_location — no code deploy required per new city, unlike geo.js's
// static tables. Run daily from cron/ingest.sh after normal ingestion.
app.post('/ingest/classify-locations', async (req, res) => {
  try {
    const { secret, limit = 40 } = req.body;
    if (secret !== process.env.INGEST_SECRET) return res.status(401).json({ error: 'unauthorized' });

    // Confirmed-noise strings ("Remote", "Hybrid", "N/A" — high-volume,
    // genuinely no place name) used to get re-asked about on every single
    // run since the ORDER BY count DESC always put them at the top of the
    // queue, permanently crowding out real-but-low-volume cities (Solihull:
    // 4 rows, Loughborough: 2 — vs. "Remote" at hundreds) from ever reaching
    // a batch slot. Once the AI confirms a string is noise, remember it here
    // so it stops competing for a spot — the answer is deterministic, asking
    // again can't change it.
    await db.query(`
      CREATE TABLE IF NOT EXISTS unresolvable_locations (
        raw_city text PRIMARY KEY,
        checked_at timestamptz DEFAULT now()
      )
    `);

    const { rows } = await db.query(`
      SELECT jl.city, count(*) AS n
      FROM job_location jl
      WHERE jl.region IS NULL AND jl.country IS NULL AND jl.city IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM unresolvable_locations ul WHERE ul.raw_city = jl.city)
      GROUP BY jl.city
      ORDER BY n DESC
      LIMIT $1
    `, [limit]);

    if (rows.length === 0) {
      return res.json({ ok: true, classified: 0, updated: 0, message: 'nothing unresolved (or everything left is already-confirmed noise)' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const cities = rows.map(r => r.city);
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `You classify raw, messy job-posting location strings (from many different ATS platforms — Greenhouse, Lever, Ashby, LinkedIn, etc; may include city/region names, noise words like "Remote"/"Hybrid", multiple locations joined with separators, or non-English text) into a single real-world country.

Respond with ONLY a JSON array, one object per input string in the same order, no other text:
[{"input": "<the exact input string>", "country": "<country name, e.g. \\"United States\\", \\"Canada\\", \\"Czech Republic\\">" or null}]

Rules:
- country must be a real country's common English name, or null.
- Return null if: the string is pure noise with no place name (e.g. "Remote", "Hybrid", "N/A", "Full-time"), it's genuinely ambiguous between multiple countries, or you're not confident.
- If a string names a specific city/region, return that place's country, not the ATS's HQ country.
- Never guess — a wrong country is worse than a null.`,
      messages: [{ role: 'user', content: JSON.stringify(cities) }],
    });

    const text = completion.content[0].text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI response did not contain a JSON array');
    const classified = JSON.parse(jsonMatch[0]);

    let updated = 0, markedNoise = 0;
    for (const c of classified) {
      if (!c.input) continue;
      if (!c.country) {
        await db.query(
          `INSERT INTO unresolvable_locations (raw_city) VALUES ($1) ON CONFLICT (raw_city) DO NOTHING`,
          [c.input]
        );
        markedNoise++;
        continue;
      }
      const result = await db.query(
        `UPDATE job_location SET country = $1 WHERE city = $2 AND country IS NULL AND region IS NULL`,
        [c.country, c.input]
      );
      updated += result.rowCount;
    }

    logger.info({ classified: classified.length, updated, markedNoise }, 'location classify-and-backfill complete');
    res.json({ ok: true, classified: classified.length, updated, markedNoise });
  } catch (e) {
    logger.error({ error: e.message }, 'classify-locations failed');
    res.status(500).json({ error: e.message });
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

    // Fetch applied jobs for this user to exclude them. Prefer job_id (resolved
    // once at apply time, stable) over URL matching (apply_url can drift on
    // re-ingestion, silently un-hiding an applied job) — URL matching is kept
    // only as a fallback for older rows where job_id couldn't be backfilled.
    const { data: appliedRows } = await sb.from('job_applications')
      .select('job_id, job_url')
      .eq('user_id', user.id);
    const appliedJobIds = (appliedRows || []).map(r => r.job_id).filter(Boolean);
    const appliedUrls = (appliedRows || []).filter(r => !r.job_id).map(r => r.job_url).filter(Boolean);
    const appliedCount = (appliedRows || []).length;

    // Companies the user has already applied to at least once — deprioritized
    // (not excluded) in the feed below. Applying at a company shouldn't hide
    // it forever (a company posts many genuinely different roles), but a
    // *different* job at that same company shouldn't compete with companies
    // the user hasn't touched yet either — especially since the same ATS
    // posting can resurface under a new external_id when a company reposts
    // it (Ashby/Greenhouse/etc. do this to bump freshness), which the applied
    // job_id exclusion above can't catch since it's a genuinely different
    // job row. Sort those companies' jobs after everything else instead of
    // interleaving them, rather than hiding them outright.
    let appliedCompanyIds = [];
    if (appliedJobIds.length > 0) {
      const { data: appliedCompanyRows } = await sb.from('job')
        .select('company_id')
        .in('id', appliedJobIds);
      appliedCompanyIds = [...new Set((appliedCompanyRows || []).map(r => r.company_id).filter(Boolean))];
    }

    // Jobs the user explicitly dismissed via "Just remove this card" — always
    // excluded regardless of the show_applied toggle (that toggle is only
    // about applied jobs, unrelated to a card the user asked to hide).
    const { data: dismissedRows } = await sb.from('dismissed_jobs')
      .select('job_id')
      .eq('user_id', user.id);
    const dismissedJobIds = (dismissedRows || []).map(r => r.job_id).filter(Boolean);

    // Load user preferences for filtering
    const { data: prefRow } = await sb.from('apply_preferences')
      .select('keywords, remote, location, salary_min, excluded_companies, excluded_titles, excluded_locations')
      .eq('user_id', user.id)
      .single();
    const pref = prefRow || {};

    // Build pref filter SQL + extra params (appended after fixed params in each query)
    const buildPrefFilters = (startIdx) => {
      const clauses = [];
      const params = [];
      let idx = startIdx;
      if (pref.remote) clauses.push(`j.remote = true`);
      if (pref.salary_min) { clauses.push(`(j.salary_min IS NULL OR j.salary_min >= $${idx})`); params.push(pref.salary_min); idx++; }
      if (pref.location) {
        const loc = pref.location.trim().toLowerCase();
        const wantsUS = ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'].includes(loc);
        if (wantsUS) {
          // "remote: true" doesn't capture WHERE remote is valid from — jobs
          // like "Remote - Bengaluru" (country: India) were passing through
          // as remote for a US-based user. Country data is too inconsistent
          // for a positive "is this the US" match (that was the earlier bug:
          // requiring literal "USA" dropped 31 companies to 4), so this
          // excludes only jobs with a clear NON-US signal instead — jobs with
          // no location data, or an unspecified/ambiguous country, still pass.
          // Also rejects recruiting-region codes in `region` (LATAM/APAC/etc
          // — never the US) and an unambiguous non-US country/region/city
          // name in the title itself, since location data is frequently
          // incomplete (bare "Canada"/"Colombia"/"Zurich" style postings —
          // see parseLocation/geo.js in normalizer.js) but the title often
          // spells it out anyway ("... - Bangalore, India", "... - LATAM").
          // The old hardcoded Indian-city regex that used to live here is
          // gone — geo.js's CITY_COUNTRY table (India cities included) now
          // resolves those to a real `country`, so the country check alone
          // covers it, with broader coverage than just India.
          clauses.push(`(
            (
              NOT EXISTS (SELECT 1 FROM job_location anyloc WHERE anyloc.job_id = j.id)
              OR EXISTS (
                SELECT 1 FROM job_location jlf WHERE jlf.job_id = j.id
                  AND (jlf.country IS NULL OR jlf.country ~* '\y(usa|us|united states)\y')
                  AND (jlf.region IS NULL OR jlf.region !~* '\y(${NON_US_REGION_CODES_SQL})\y')
              )
            )
            AND j.title !~* '${NON_US_TITLE_REGEX_SQL}'
          )`);
        } else {
          clauses.push(`EXISTS (SELECT 1 FROM job_location jlf WHERE jlf.job_id = j.id AND (jlf.city ILIKE $${idx} OR jlf.region ILIKE $${idx} OR jlf.country ILIKE $${idx}))`);
          params.push(`%${pref.location}%`); idx++;
        }
      }
      // Matched against company.name_normalized / a normalized job title, not
      // the raw strings — a company re-ingested under a new domain gets a
      // slightly different name_normalized only if it's genuinely a
      // different company; the same company always normalizes the same way,
      // so a dismissed company can't silently reappear via a new domain
      // variant (see normalizeCompanyName in services/normalizer.js).
      if ((pref.excluded_companies || []).length) {
        clauses.push(`c.name_normalized != ALL($${idx}::text[])`);
        params.push(pref.excluded_companies.map(normalizeCompanyName)); idx++;
      }
      if ((pref.excluded_titles || []).length) {
        clauses.push(`lower(trim(regexp_replace(j.title, '\\s+', ' ', 'g'))) != ALL($${idx}::text[])`);
        params.push(pref.excluded_titles.map(normalizeTitle)); idx++;
      }
      if ((pref.excluded_locations || []).length) {
        clauses.push(`NOT EXISTS (
          SELECT 1 FROM job_location xl WHERE xl.job_id = j.id
            AND (xl.city = ANY($${idx}::text[]) OR xl.region = ANY($${idx}::text[]) OR xl.country = ANY($${idx}::text[]))
        )`);
        params.push(pref.excluded_locations); idx++;
      }
      return { sql: clauses.map(c => `AND ${c}`).join(' '), params };
    };

    // Build exclusion clause for applied + dismissed jobs. Prefers matching
    // by j.id (stable, resolved/recorded once, at apply/dismiss time) and
    // only falls back to URL-string comparison for legacy applied-job rows
    // with no job_id — apply_url can drift on re-ingestion, so a pure URL
    // match silently un-hides applied jobs over time (see job_id backfill in
    // the migration). Dismissed jobs are always excluded, independent of
    // hideApplied — that toggle only concerns applied jobs.
    const excludedJobIds = [...dismissedJobIds, ...(hideApplied ? appliedJobIds : [])];
    const excludeClause = (paramIdx) => {
      const idClause = excludedJobIds.length > 0 ? `j.id = ANY($${paramIdx}::bigint[])` : null;
      const urlClause = hideApplied && appliedUrls.length > 0
        ? `EXISTS (
            SELECT 1 FROM unnest($${paramIdx + (idClause ? 1 : 0)}::text[]) au(url)
            WHERE rtrim(split_part(j.apply_url, '?', 1), '/') = rtrim(split_part(au.url, '?', 1), '/')
          )`
        : null;
      const inner = [idClause, urlClause].filter(Boolean);
      return inner.length ? `AND NOT (${inner.join(' OR ')})` : '';
    };
    const excludeClauseParams = [
      ...(excludedJobIds.length > 0 ? [excludedJobIds] : []),
      ...(hideApplied && appliedUrls.length > 0 ? [appliedUrls] : []),
    ];

    // Build title search query:
    // 1. apply_preferences.keywords is the explicit user intent ("software engineer", "backend")
    // 2. user_signals.keywords is derived from past applications — supplement only
    const { data: signals } = await sb.from('user_signals')
      .select('keywords, preferred_titles')
      .eq('user_id', user.id)
      .single();

    // Build tsquery from preference keywords:
    // Each phrase ("software engineer") becomes word1 <-> word2 — Postgres's
    // phrase/adjacency operator, requiring the words to appear next to each
    // other in that order, not just independently anywhere in the job's
    // title+description. Multiple phrases are joined with | (OR between
    // phrases). Previously used `&` (plain AND, order/adjacency-agnostic),
    // which let a job satisfy "software & engineer" from unrelated text —
    // e.g. a company's own boilerplate ("Full Spectrum Software...") plus
    // an "Electrical Engineering" job title matched "Software Engineer"
    // even though the role has nothing to do with software.
    // Signal keywords are only used when the user has set NO explicit preferences.
    const prefPhrases = (pref.keywords || [])
      .map(phrase => phrase.trim().split(/[\s,]+/)
        .map(w => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean).join(' <-> '))
      .filter(Boolean);
    const signalKeywords = prefPhrases.length === 0 ? (signals?.keywords || []) : [];
    const signalPhrases = signalKeywords
      .map(k => k.replace(/[^a-z0-9]/gi, '')).filter(k => /^[a-z0-9]+$/i.test(k));

    const allPhrases = [...new Set([...prefPhrases, ...signalPhrases])];
    // Flatten individual words for the hasAnyPrefs check
    const allKeywords = allPhrases.flatMap(p => p.split(' <-> '));

    let jobs = [];

    if (allPhrases.length > 0) {
      const tsQuery = allPhrases.join(' | ');
      const extraParams = excludeClauseParams;
      const pf = buildPrefFilters(4 + extraParams.length);
      const appliedCompanyIdx = 4 + extraParams.length + pf.params.length;
      const result = await db.query(`
        SELECT
          bpc.*,
          loc.cities,
          loc.countries
        FROM (
          SELECT DISTINCT ON (j.company_id)
            j.*,
            c.name as company_name,
            c.domain as company_domain, c.logo_domain as company_logo_domain,
            ts_rank(j.tsv, to_tsquery('english', $1)) as relevance
          FROM job j
          JOIN company c ON j.company_id = c.id
          WHERE j.tsv @@ to_tsquery('english', $1)
          AND j.is_active = true
          ${excludeClause(4)}
          ${pf.sql}
          ORDER BY j.company_id, ts_rank(j.tsv, to_tsquery('english', $1)) DESC, j.posted_at DESC NULLS LAST, j.id DESC
        ) bpc
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
                 array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
          FROM job_location jl WHERE jl.job_id = bpc.id
        ) loc ON true
        -- Companies already applied to sort after everything else (not
        -- excluded — see appliedCompanyIds comment above) so a different
        -- role at an already-applied company doesn't compete with
        -- companies the user hasn't touched yet.
        ORDER BY (bpc.company_id = ANY($${appliedCompanyIdx}::bigint[])) ASC, bpc.relevance DESC, bpc.posted_at DESC NULLS LAST, bpc.id DESC
        LIMIT $2 OFFSET $3
      `, [tsQuery, limit, offset, ...extraParams, ...pf.params, appliedCompanyIds]);
      jobs = result.rows;
    }

    // Only skip the recency fallback if the user has set EXPLICIT preferences.
    // Signal-derived keywords (from resume/applied titles) are inferred, not
    // chosen by the user, and shouldn't be able to starve the feed to zero
    // just because they don't happen to match the (currently small) job corpus.
    const hasExplicitPrefs = prefPhrases.length > 0 || pref.remote || pref.location || pref.salary_min;
    if (jobs.length < 10 && !hasExplicitPrefs) {
      const extraParams = excludeClauseParams;
      const fallbackExclude = excludeClause(3);
      const fpf = buildPrefFilters(3 + extraParams.length);
      const appliedCompanyIdx = 3 + extraParams.length + fpf.params.length;
      const result = await db.query(`
        SELECT bpc.*, loc.cities, loc.countries
        FROM (
          SELECT DISTINCT ON (j.company_id)
            j.*, c.name as company_name, c.domain as company_domain, c.logo_domain as company_logo_domain
          FROM job j
          JOIN company c ON j.company_id = c.id
          WHERE j.is_active = true ${fallbackExclude} ${fpf.sql}
          ORDER BY j.company_id, j.posted_at DESC NULLS LAST, j.id DESC
        ) bpc
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
                 array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
          FROM job_location jl WHERE jl.job_id = bpc.id
        ) loc ON true
        ORDER BY (bpc.company_id = ANY($${appliedCompanyIdx}::bigint[])) ASC, bpc.posted_at DESC NULLS LAST, bpc.id DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset, ...extraParams, ...fpf.params, appliedCompanyIds]);
      jobs = result.rows;
    }

    res.json({ jobs, count: jobs.length, keywords: allKeywords, appliedCount, offset: parseInt(offset), limit: parseInt(limit) });
  } catch (e) {
    logger.error({ error: e }, 'Personalized jobs error');
    res.status(500).json({ error: 'Failed to fetch personalized jobs' });
  }
});

// Simple in-process cache for job listings
const jobCache = new Map();
const JOB_CACHE_TTL = 60_000; // 60s
function getCached(key) {
  const entry = jobCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > JOB_CACHE_TTL) { jobCache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  if (jobCache.size > 200) jobCache.clear(); // safety cap
  jobCache.set(key, { data, ts: Date.now() });
}

app.get('/jobs', async (req, res) => {
  try {
    const {
      keyword,
      location,
      remote,
      company,
      provider,
      posted_since,
      employment_type,
      salary_min,
      days,
      limit = 50,
      offset = 0,
    } = req.query;

    // Optional auth: unlike /jobs/personalized, a token isn't required here
    // -- this stays the public listing endpoint. But when a signed-in user
    // hits it (e.g. the frontend falls back to this route the moment any
    // search/location/remote filter is active, per fetchJobs in App.jsx),
    // their preferences must still apply. Before this, /jobs ignored
    // dismissed jobs, excluded companies/titles/locations, and the
    // non-US-location filter entirely -- a dismissed card, or a job in a
    // country the user's profile says "USA," could reappear the instant
    // any filter box was used, since only /jobs/personalized ever checked
    // any of that. A bad/expired token here is not an error; it just means
    // no preference filtering, same as an anonymous request. SQL/params for
    // this are built below, once paramCount is known, not here.
    let pref = null;
    let dismissedJobIds = [];
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const sb = getSupabase();
        const { data: { user } } = await sb.auth.getUser(token);
        if (user) {
          const [{ data: prefRow }, { data: dismissedRows }] = await Promise.all([
            sb.from('apply_preferences')
              .select('location, excluded_companies, excluded_titles, excluded_locations')
              .eq('user_id', user.id).single(),
            sb.from('dismissed_jobs').select('job_id').eq('user_id', user.id),
          ]);
          pref = prefRow || {};
          dismissedJobIds = (dismissedRows || []).map(r => r.job_id).filter(Boolean);
        }
      } catch (e) {
        logger.warn({ err: e.message }, 'Optional auth pref-filter on /jobs failed -- continuing unfiltered');
      }
    }

    let query = `
      SELECT 
        j.*,
        c.name as company_name,
        c.domain as company_domain, c.logo_domain as company_logo_domain,
        array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
        array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
      FROM job j
      JOIN company c ON j.company_id = c.id
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE j.is_active = true
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

    if (provider) {
      paramCount++;
      query += ` AND j.provider = $${paramCount}`;
      params.push(provider);
    }

    if (posted_since) {
      paramCount++;
      query += ` AND j.posted_at >= $${paramCount}`;
      params.push(posted_since);
    }

    if (days) {
      paramCount++;
      query += ` AND j.posted_at >= NOW() - ($${paramCount} || ' days')::interval`;
      params.push(parseInt(days));
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

    // Preference-based exclusions, built now that paramCount reflects every
    // explicit filter above — see the optional-auth block near the top of
    // this handler for why this exists at all.
    if (pref) {
      if (dismissedJobIds.length) {
        paramCount++;
        query += ` AND j.id != ALL($${paramCount}::bigint[])`;
        params.push(dismissedJobIds);
      }
      if ((pref.excluded_companies || []).length) {
        paramCount++;
        query += ` AND c.name_normalized != ALL($${paramCount}::text[])`;
        params.push(pref.excluded_companies.map(normalizeCompanyName));
      }
      if ((pref.excluded_titles || []).length) {
        paramCount++;
        query += ` AND lower(trim(regexp_replace(j.title, '\\s+', ' ', 'g'))) != ALL($${paramCount}::text[])`;
        params.push(pref.excluded_titles.map(normalizeTitle));
      }
      if ((pref.excluded_locations || []).length) {
        paramCount++;
        query += ` AND NOT EXISTS (
          SELECT 1 FROM job_location xl WHERE xl.job_id = j.id
            AND (xl.city = ANY($${paramCount}::text[]) OR xl.region = ANY($${paramCount}::text[]) OR xl.country = ANY($${paramCount}::text[]))
        )`;
        params.push(pref.excluded_locations);
      }
      // Same non-US signal check as /jobs/personalized's wantsUS branch —
      // only applied if the user's stored location preference is the US.
      const locPref = (pref.location || '').trim().toLowerCase();
      if (['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'].includes(locPref)) {
        query += ` AND (
          (
            NOT EXISTS (SELECT 1 FROM job_location anyloc WHERE anyloc.job_id = j.id)
            OR EXISTS (
              SELECT 1 FROM job_location jlf WHERE jlf.job_id = j.id
                AND (jlf.country IS NULL OR jlf.country ~* '\\y(usa|us|united states)\\y')
                AND (jlf.region IS NULL OR jlf.region !~* '\\y(${NON_US_REGION_CODES_SQL})\\y')
            )
          )
          AND j.title !~* '${NON_US_TITLE_REGEX_SQL}'
        )`;
      }
    }

    query += ` GROUP BY j.id, c.name, c.domain, c.logo_domain`;
    query += ` ORDER BY j.posted_at DESC NULLS LAST`;
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);
    
    const cacheKey = JSON.stringify(params) + query.slice(-20);
    const cached = getCached(cacheKey);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const result = await db.query(query, params);
    const payload = {
      jobs: result.rows,
      count: result.rows.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
    };
    setCache(cacheKey, payload);
    res.set('X-Cache', 'MISS');
    res.json(payload);
  } catch (error) {
    logger.error({ error }, 'Jobs API error');
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Sitemap — regenerated from live company data (shares the 60s job-listing
// cache) so it stays current as ingestion adds companies daily, instead of
// going stale like a static file.
app.get('/sitemap.xml', async (req, res) => {
  try {
    const cacheKey = 'sitemap.xml';
    const cached = getCached(cacheKey);
    if (cached) {
      res.set('Content-Type', 'application/xml');
      res.set('X-Cache', 'HIT');
      return res.send(cached);
    }

    const result = await db.query(`
      SELECT lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) as slug,
             MAX(j.posted_at) as last_posted
      FROM company c
      JOIN job j ON j.company_id = c.id
      WHERE j.is_active = true
      GROUP BY c.id
      HAVING COUNT(j.id) > 0
      ORDER BY slug
    `);

    const SITE = 'https://www.simplyappl.ai';
    const urls = [
      { loc: `${SITE}/`, priority: '1.0' },
      { loc: `${SITE}/privacy`, priority: '0.3' },
      ...result.rows.map(r => ({
        loc: `${SITE}/companies/${r.slug}`,
        lastmod: r.last_posted ? new Date(r.last_posted).toISOString().slice(0, 10) : undefined,
        priority: '0.7',
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    setCache(cacheKey, xml);
    res.set('Content-Type', 'application/xml');
    res.set('X-Cache', 'MISS');
    res.send(xml);
  } catch (e) {
    logger.error({ error: e }, 'Sitemap generation error');
    res.status(500).send('');
  }
});

// Get single job
// Company pages
// ── Dynamic rendering for crawlers ──────────────────────────────────────────
// The React frontend is 100% client-rendered, so a non-JS crawler (most AI
// bots included) sees an empty <div id="root"> at these URLs. nginx on
// elevate-careers-web detects bot user-agents and proxies /companies/:slug
// (and /) to these SSR routes instead of serving the SPA shell — real users
// still get the normal React app. See job-aggregator-frontend/nginx.conf.
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

app.get('/ssr/home', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.name, c.domain,
             lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) as slug,
             COUNT(j.id) as open_jobs
      FROM company c
      JOIN job j ON j.company_id = c.id
      WHERE j.is_active = true
      GROUP BY c.id
      ORDER BY open_jobs DESC
      LIMIT 200
    `);

    const SITE = 'https://www.simplyappl.ai';
    const rows = result.rows;
    const listItems = rows.map((r, i) => `
      <li>
        <a href="${SITE}/companies/${r.slug}">${escapeHtml(r.name)}</a>
        — ${r.open_jobs} open role${r.open_jobs === '1' ? '' : 's'}
      </li>`).join('');

    const itemListLd = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: rows.map((r, i) => ({
        '@type': 'ListItem', position: i + 1,
        url: `${SITE}/companies/${r.slug}`, name: r.name,
      })),
    };

    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<title>SimplyApply — AI Job Autofill</title>
<meta name="description" content="Autofill job applications in one click. SimplyApply fills Greenhouse, Lever, Ashby and more using your saved profile."/>
<link rel="canonical" href="${SITE}/"/>
<script type="application/ld+json">${JSON.stringify(itemListLd)}</script>
</head><body>
<h1>SimplyApply — AI Job Autofill</h1>
<p>Autofill job applications in one click. SimplyApply fills Greenhouse, Lever, Ashby, SmartRecruiters and more using your saved profile. Free Chrome extension.</p>
<h2>Companies hiring now</h2>
<ul>${listItems}</ul>
</body></html>`);
  } catch (e) {
    res.status(500).send('');
  }
});

app.get('/ssr/companies/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const companyResult = await db.query(`
      SELECT c.*, COUNT(j.id) FILTER (WHERE j.is_active) AS open_jobs
      FROM company c
      LEFT JOIN job j ON j.company_id = c.id
      WHERE lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) = $1
         OR c.domain ILIKE $1 || '.%'
      GROUP BY c.id
      LIMIT 1
    `, [slug]);
    const company = companyResult.rows[0];
    if (!company) return res.status(404).send('');

    const jobsResult = await db.query(`
      SELECT j.title, j.apply_url, j.posted_at, j.employment_type, j.remote,
             j.salary_min, j.salary_max, j.description_excerpt,
             array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
             array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
      FROM job j
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE j.company_id = $1 AND j.is_active = true
      GROUP BY j.id
      ORDER BY j.posted_at DESC NULLS LAST
      LIMIT 100
    `, [company.id]);
    const jobs = jobsResult.rows;

    const SITE = 'https://www.simplyappl.ai';
    const jobItems = jobs.map(j => `
      <li>
        <a href="${escapeHtml(j.apply_url)}">${escapeHtml(j.title)}</a>
        ${j.remote ? ' — Remote' : (j.cities || [])[0] ? ` — ${escapeHtml(j.cities[0])}` : ''}
        ${j.posted_at ? ` — posted ${new Date(j.posted_at).toISOString().slice(0, 10)}` : ''}
      </li>`).join('');

    const jobPostingsLd = jobs.map(j => ({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: j.title,
      description: j.description_excerpt || j.title,
      datePosted: j.posted_at ? new Date(j.posted_at).toISOString().slice(0, 10) : undefined,
      employmentType: j.employment_type || undefined,
      hiringOrganization: { '@type': 'Organization', name: company.name, sameAs: company.domain ? `https://${company.domain}` : undefined },
      jobLocationType: j.remote ? 'TELECOMMUTE' : undefined,
      applicantLocationRequirements: j.remote ? { '@type': 'Country', name: 'US' } : undefined,
      jobLocation: (!j.remote && (j.cities || [])[0]) ? {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: j.cities[0], addressCountry: (j.countries || [])[0] || undefined },
      } : undefined,
      directApply: true,
      url: j.apply_url,
    }));

    res.set('Content-Type', 'text/html');
    res.send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeHtml(company.name)} jobs — SimplyApply</title>
<meta name="description" content="${company.open_jobs} open roles at ${escapeHtml(company.name)}, aggregated by SimplyApply."/>
<link rel="canonical" href="${SITE}/companies/${slug}"/>
${jobPostingsLd.map(ld => `<script type="application/ld+json">${JSON.stringify(ld)}</script>`).join('\n')}
</head><body>
<h1>${escapeHtml(company.name)} — ${company.open_jobs} open roles</h1>
<p><a href="${SITE}/">Back to SimplyApply</a></p>
<ul>${jobItems}</ul>
</body></html>`);
  } catch (e) {
    res.status(500).send('');
  }
});

app.get('/companies/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await db.query(`
      SELECT c.*, COUNT(j.id) FILTER (WHERE j.is_active) AS open_jobs
      FROM company c
      LEFT JOIN job j ON j.company_id = c.id
      WHERE lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) = $1
         OR c.domain ILIKE $1 || '.%'
      GROUP BY c.id
      LIMIT 1
    `, [slug]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Company not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/companies/:slug/jobs', async (req, res) => {
  try {
    const { slug } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Optional auth, same pattern as /jobs: this stays a public page (also
    // SSR'd for bots, see /ssr/companies/:slug), so a token isn't required —
    // but when a signed-in user with a US-only preference hits it, that
    // preference should apply here too. Before this, a company page showed
    // every open role at a company regardless of location, even when the
    // exact same job was correctly excluded from "Recommended for you" for
    // being e.g. region-scoped to Europe — the two pages disagreed on
    // whether the user actually wanted to see it.
    let wantsUS = false;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const sb = getSupabase();
        const { data: { user } } = await sb.auth.getUser(token);
        if (user) {
          const { data: prefRow } = await sb.from('apply_preferences')
            .select('location').eq('user_id', user.id).single();
          const locPref = (prefRow?.location || '').trim().toLowerCase();
          wantsUS = ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america'].includes(locPref);
        }
      } catch (e) {
        logger.warn({ err: e.message }, 'Optional auth pref-filter on /companies/:slug/jobs failed -- continuing unfiltered');
      }
    }

    const result = await db.query(`
      SELECT j.*, c.name as company_name, c.domain as company_domain, c.logo_domain as company_logo_domain,
        array_agg(DISTINCT jl.city) FILTER (WHERE jl.city IS NOT NULL) as cities,
        array_agg(DISTINCT jl.country) FILTER (WHERE jl.country IS NOT NULL) as countries
      FROM job j
      JOIN company c ON j.company_id = c.id
      LEFT JOIN job_location jl ON j.id = jl.job_id
      WHERE j.is_active = true
        AND (
          lower(regexp_replace(c.name, '[^a-zA-Z0-9]+', '-', 'g')) = $1
          OR c.domain ILIKE $1 || '.%'
        )
        ${wantsUS ? `AND (
          (
            NOT EXISTS (SELECT 1 FROM job_location anyloc WHERE anyloc.job_id = j.id)
            OR EXISTS (
              SELECT 1 FROM job_location jlf WHERE jlf.job_id = j.id
                AND (jlf.country IS NULL OR jlf.country ~* '\\y(usa|us|united states)\\y')
                AND (jlf.region IS NULL OR jlf.region !~* '\\y(${NON_US_REGION_CODES_SQL})\\y')
            )
          )
          AND j.title !~* '${NON_US_TITLE_REGEX_SQL}'
        )` : ''}
      GROUP BY j.id, c.name, c.domain, c.logo_domain
      ORDER BY j.posted_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, [slug, limit, offset]);
    res.json({ jobs: result.rows, count: result.rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT 
        j.*,
        c.name as company_name,
        c.domain as company_domain, c.logo_domain as company_logo_domain,
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
      GROUP BY j.id, c.name, c.domain, c.logo_domain, jv.description_md, jv.skills
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

// ── Hourly auto-apply scheduler ──────────────────────────────────────────────
// For each user with preferences.enabled=true, find matching jobs they haven't
// applied to yet, and enqueue up to daily_limit applications per day.
async function runAutoApplyScheduler() {
  try {
    const { Queue } = await import('bullmq');
    const { connection } = await import('../services/queue.js');
    if (!connection) return; // Redis not configured — skip

    const queue = new Queue('playwright-apply', {
      connection,
      defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 100 },
    });

    // Get all users with auto-apply-similar enabled
    const prefsResult = await db.query(
      `SELECT user_id, remote, location, salary_min, excluded_companies, daily_limit, auto_apply_similar
       FROM apply_preferences WHERE enabled = true AND auto_apply_similar = true`
    );

    for (const prefs of prefsResult.rows) {
      try {
        // How many auto-applies already fired today?
        const todayResult = await db.query(
          `SELECT COUNT(*) as cnt FROM job_applications
           WHERE user_id=$1 AND auto_applied=true AND created_at >= NOW() - INTERVAL '24 hours'`,
          [prefs.user_id]
        );
        const firedToday = parseInt(todayResult.rows[0].cnt, 10);
        const remaining = prefs.daily_limit - firedToday;
        if (remaining <= 0) continue;

        // Get user profile
        const profileResult = await db.query(
          `SELECT autofill_data FROM user_profile WHERE user_id=$1 LIMIT 1`,
          [prefs.user_id]
        );
        const profile = profileResult.rows[0]?.autofill_data;
        if (!profile || Object.keys(profile).length === 0) continue;

        // Get already-applied jobs — prefer job_id (stable) over job_url
        // (drifts on re-ingestion), same reasoning as /jobs/personalized.
        const appliedResult = await db.query(
          `SELECT job_id, job_url FROM job_applications WHERE user_id=$1`,
          [prefs.user_id]
        );
        const appliedJobIds = appliedResult.rows.map(r => r.job_id).filter(Boolean);
        const appliedUrls = appliedResult.rows.filter(r => !r.job_id).map(r => r.job_url).filter(Boolean);

        // Derive keywords from past application job titles
        const titlesResult = await db.query(
          `SELECT job_title FROM job_applications WHERE user_id=$1 AND job_title IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
          [prefs.user_id]
        );
        const allWords = titlesResult.rows.flatMap(r => r.job_title.split(/\s+/));
        const safeKeywords = [...new Set(
          allWords.filter(w => w.length > 3 && /^[a-z0-9#+.\-]+$/i.test(w))
        )].slice(0, 15);
        if (safeKeywords.length === 0) continue;
        const tsQuery = safeKeywords.join(' | ');

        let jobQuery = `
          SELECT j.id, j.apply_url, j.title, c.name as company_name
          FROM job j JOIN company c ON j.company_id = c.id
          WHERE j.tsv @@ to_tsquery('english', $1)
            AND j.posted_at >= NOW() - INTERVAL '7 days'
        `;
        const queryParams = [tsQuery];
        let pidx = 2;

        if (prefs.remote) { jobQuery += ` AND j.remote = true`; }
        if (prefs.salary_min) { jobQuery += ` AND (j.salary_min IS NULL OR j.salary_min >= $${pidx})`; queryParams.push(prefs.salary_min); pidx++; }
        if (appliedJobIds.length) {
          jobQuery += ` AND j.id != ALL($${pidx}::bigint[])`;
          queryParams.push(appliedJobIds);
          pidx++;
        }
        if (appliedUrls.length) {
          jobQuery += ` AND j.apply_url NOT IN (${appliedUrls.map((_, i) => `$${pidx + i}`).join(',')})`;
          queryParams.push(...appliedUrls);
          pidx += appliedUrls.length;
        }
        if ((prefs.excluded_companies || []).length) {
          jobQuery += ` AND c.name_normalized != ALL($${pidx}::text[])`;
          queryParams.push(prefs.excluded_companies.map(normalizeCompanyName));
          pidx++;
        }

        jobQuery += ` ORDER BY j.posted_at DESC LIMIT $${pidx}`;
        queryParams.push(remaining);

        const jobsResult = await db.query(jobQuery, queryParams);
        for (const job of jobsResult.rows) {
          const appResult = await db.query(
            `INSERT INTO job_applications (user_id, job_url, job_title, company, status, auto_applied, source, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'queued',true,'auto',NOW(),NOW()) RETURNING id`,
            [prefs.user_id, job.apply_url, job.title, job.company_name]
          );
          await queue.add('apply', {
            applicationId: appResult.rows[0].id,
            jobUrl: job.apply_url,
            profile,
            jobDescription: '',
            dryRun: false,
          });
        }

        if (jobsResult.rows.length > 0) {
          logger.info({ userId: prefs.user_id, enqueued: jobsResult.rows.length }, 'Auto-apply scheduler enqueued jobs');
        }
      } catch (userErr) {
        logger.error({ error: userErr, userId: prefs.user_id }, 'Auto-apply scheduler user error');
      }
    }
  } catch (e) {
    logger.error({ error: e }, 'Auto-apply scheduler error');
  }
}

// Run scheduler once on startup (after 30s to let DB warm up), then every hour
setTimeout(() => {
  runAutoApplyScheduler();
  setInterval(runAutoApplyScheduler, 60 * 60 * 1000);
}, 30_000);

// Serve React frontend in web mode
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendBuild = path.join(__dirname, '../../job-aggregator-frontend/build');
import fs from 'fs';
if (fs.existsSync(frontendBuild)) {
  app.use(express.static(frontendBuild));
  app.use((req, res) => {
    res.sendFile(path.join(frontendBuild, 'index.html'));
  });
} else {
  // 404 handler (API-only mode)
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;