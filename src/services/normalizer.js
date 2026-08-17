import crypto from 'crypto';
import TurndownService from 'turndown';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { resolveLocationToken, tokenizeLocation } from './geo.js';
import { sitemapSlug, pingIndexNowForCompanies } from './indexnow.js';

const turndownService = new TurndownService();

// Mirrors the SQL normalization in the company_identity_and_applied_job_id
// migration exactly — keep both in sync, they're compared directly.
export function normalizeCompanyName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co)\.?\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Slug form of normalizeCompanyName, for building a company_domain used in
// job dedup keys (generateDedupeKey below). MUST derive from the same
// normalization as company matching (getOrCreateCompany's name_normalized
// lookup) — building the slug from the raw company name independently, as
// the /ingest/jobspy and /ingest/linkedin routes used to, let minor source
// variation ("Clarion" vs "Clarion Inc." on different scrape runs) produce
// two different company_domain values and therefore two different
// dedupe_keys for the exact same posting (same external_id), even though
// getOrCreateCompany correctly resolved both to the same company row —
// confirmed via duplicate job/application rows for identical LinkedIn
// postings applied to on the same day.
export function companySlug(name) {
  return normalizeCompanyName(name).replace(/\s+/g, '-') || 'unknown';
}

// Mirrors the SQL `lower(trim(regexp_replace(title, '\s+', ' ', 'g')))` used
// in the excluded_titles filter — catches case/whitespace variants only,
// not reworded titles (e.g. "... II" suffix). Full fuzzy title matching is
// a separate, larger piece of work.
export function normalizeTitle(title) {
  return (title || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Resolves a company's real website domain from its name, for logo lookups —
// company.domain is the ATS subdomain (bumbleinc.greenhouse.io), which isn't
// resolvable by a logo API. Free, unauthenticated, no published rate limit;
// never throws — a failed/slow lookup shouldn't break company creation.
export async function resolveLogoDomain(name) {
  if (!name) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const results = await res.json();
    return results[0]?.domain || null;
  } catch (e) {
    logger.warn({ error: e.message, name }, 'Logo domain lookup failed');
    return null;
  }
}

export class NormalizerService {
  
  async processJobs(jobs, provider, org) {
    const results = { created: 0, updated: 0, skipped: 0, expired: 0, errors: [] };
    const changedCompanySlugs = new Set();

    // Track which external_ids are currently live in this fetch
    const liveIds = new Set(jobs.map(j => j.external_id).filter(Boolean));

    for (const rawJob of jobs) {
      try {
        const { companySlug: slug, changed } = await this.processJob(rawJob, provider, org);
        if (changed) changedCompanySlugs.add(slug);
        results.created++;
      } catch (error) {
        logger.error({ error, rawJob }, 'Failed to process job');
        results.errors.push({ job: rawJob.title, error: error.message });
      }
    }

    // Mark jobs from this org that are no longer in the feed as inactive
    if (liveIds.size > 0) {
      try {
        const domain = `${org}.${provider === 'greenhouse' ? 'greenhouse' : provider === 'lever' ? 'lever' : provider === 'ashby' ? 'ashbyhq' : provider}.io`;
        const expired = await db.query(`
          UPDATE job j SET is_active = false
          FROM company c
          WHERE j.company_id = c.id
            AND c.domain ILIKE $1
            AND j.provider = $2
            AND j.external_id IS NOT NULL
            AND j.external_id != ALL($3)
            AND j.is_active = true
          RETURNING c.name
        `, [`%${org}%`, provider, [...liveIds]]);
        results.expired = expired.rowCount;
        if (expired.rowCount > 0) {
          logger.info({ org, provider, expired: expired.rowCount }, 'Marked jobs inactive');
          for (const row of expired.rows) changedCompanySlugs.add(sitemapSlug(row.name));
        }
      } catch (e) {
        logger.warn({ error: e.message }, 'Could not mark expired jobs');
      }
    }

    if (changedCompanySlugs.size > 0) {
      pingIndexNowForCompanies([...changedCompanySlugs]);
    }

    return results;
  }

  async processJob(rawJob, provider, org) {
    // Generate dedupe key
    const dedupeKey = this.generateDedupeKey(rawJob);
    
    // Get or create company
    const company = await this.getOrCreateCompany(rawJob.company_domain || `${org}.${provider}.io`, provider, org);
    
    // Convert HTML to Markdown
    const descriptionMd = this.htmlToMarkdown(rawJob.description);
    const descriptionExcerpt = this.createExcerpt(descriptionMd, 500);
    
    // Check if job exists
    const existing = await this.findExistingJob(dedupeKey);
    let changed = false;

    if (existing) {
      // Check if significant fields changed
      if (this.hasSignificantChanges(existing, rawJob, descriptionMd)) {
        await this.updateJob(existing, rawJob, company.id, descriptionMd, descriptionExcerpt);
        await this.createJobVersion(existing.id, descriptionMd);
        changed = true;
      }
    } else {
      // Create new job
      const jobId = await this.createJob(rawJob, company.id, dedupeKey, descriptionMd, descriptionExcerpt);
      await this.createJobVersion(jobId, descriptionMd);
      await this.createJobLocations(jobId, rawJob);
      changed = true;
    }

    return { dedupeKey, companySlug: sitemapSlug(company.name), changed };
  }

  generateDedupeKey(job) {
    let keyString;
    
    if (job.external_id && job.company_domain) {
      keyString = `${job.company_domain}:${job.provider}:${job.external_id}`;
    } else {
      // Fallback for jobs without external_id
      const title = job.title || '';
      const location = job.location || '';
      const desc = (job.description || '').substring(0, 200);
      keyString = `${job.company_domain}:${title}:${location}:${desc}`;
    }
    
    return crypto.createHash('sha1').update(keyString).digest('hex');
  }

  async getOrCreateCompany(domain, provider, org) {
    const result = await db.query(
      'SELECT * FROM company WHERE domain = $1',
      [domain]
    );

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Prefer the real display name discovered from GitHub datasets (e.g.
    // "Q-CTRL", "Bumble Inc") over slugifying the domain, which just turns
    // "bumbleinc.greenhouse.io" into "bumbleinc" — not a company name.
    let name = domain.split('.')[0].replace(/-/g, ' ');
    if (provider && org) {
      const discovered = await db.query(
        'SELECT name FROM discovered_company WHERE provider = $1 AND org = $2 AND name IS NOT NULL',
        [provider, org]
      );
      if (discovered.rows[0]?.name) name = discovered.rows[0].name;
    }

    // Domain alone isn't a stable company identity — the same company shows
    // up under different domains across ingestion adapters/runs (ATS
    // subdomain vs. a later-discovered custom domain, casing, etc). Before
    // creating a new row, check whether a company with the same normalized
    // name already exists and reuse it — otherwise a domain variant spawns
    // a duplicate company row that user exclusions (matched by name) can't
    // find, and jobs from an "excluded" company silently reappear.
    const normalized = normalizeCompanyName(name);
    const byName = await db.query(
      'SELECT * FROM company WHERE name_normalized = $1 LIMIT 1',
      [normalized]
    );
    if (byName.rows.length > 0) {
      return byName.rows[0];
    }

    const logoDomain = await resolveLogoDomain(name);

    const insert = await db.query(
      'INSERT INTO company (name, domain, logo_domain, name_normalized) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, domain, logoDomain, normalized]
    );

    return insert.rows[0];
  }

  async findExistingJob(dedupeKey) {
    const result = await db.query(
      'SELECT * FROM job WHERE dedupe_key = $1',
      [dedupeKey]
    );
    return result.rows[0];
  }

  async createJob(job, companyId, dedupeKey, descriptionMd, descriptionExcerpt) {
    const result = await db.query(`
      INSERT INTO job (
        company_id, provider, external_id, apply_url, title,
        employment_type, remote, salary_min, salary_max, salary_currency,
        posted_at, valid_through, description_excerpt, dedupe_key, tsv
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        setweight(to_tsvector('english', $5), 'A') || setweight(to_tsvector('english', COALESCE($13, '')), 'D')
      ) RETURNING id
    `, [
      companyId,
      job.provider,
      job.external_id,
      job.apply_url,
      job.title,
      job.employment_type,
      job.remote,
      job.salary_min,
      job.salary_max,
      job.salary_currency,
      job.posted_at,
      job.valid_through,
      descriptionExcerpt,
      dedupeKey,
    ]);
    
    return result.rows[0].id;
  }

  async updateJob(existing, job, companyId, descriptionMd, descriptionExcerpt) {
    await db.query(`
      UPDATE job SET
        company_id = $1,
        apply_url = $2,
        title = $3,
        employment_type = $4,
        remote = $5,
        salary_min = $6,
        salary_max = $7,
        salary_currency = $8,
        valid_through = $9,
        description_excerpt = $10,
        -- COALESCE against the existing column, not the incoming value: this
        -- previously wasn't updated at all, which left LinkedIn-sourced jobs
        -- (ingested with posted_at=null before the /ingest/linkedin fix)
        -- permanently stuck with a null date, sorting to the bottom of
        -- every search (ORDER BY posted_at DESC NULLS LAST in /jobs). Backfill
        -- from a future re-ingest without ever overwriting a real date with
        -- null from some other source's incomplete payload.
        posted_at = COALESCE($11, posted_at),
        -- Title weighted far above description ('A' vs 'D') — an incidental
        -- description mention (e.g. a generic "who should apply: software
        -- engineers, sales reps, ..." boilerplate paragraph on an unrelated
        -- role) shouldn't rank/match on par with an actual title match.
        -- Confirmed needed: a Nextech "Regional Sales Director" posting
        -- matched a "software engineer" search purely off that kind of
        -- boilerplate line.
        tsv = setweight(to_tsvector('english', $3), 'A') || setweight(to_tsvector('english', COALESCE($10, '')), 'D'),
        updated_at = now()
      WHERE id = $12
    `, [
      companyId,
      job.apply_url,
      job.title,
      job.employment_type,
      job.remote,
      job.salary_min,
      job.salary_max,
      job.salary_currency,
      job.valid_through,
      descriptionExcerpt,
      job.posted_at,
      existing.id,
    ]);
  }

  async createJobVersion(jobId, descriptionMd) {
    const result = await db.query(`
      INSERT INTO job_version (job_id, description_md)
      VALUES ($1, $2)
      RETURNING id
    `, [jobId, descriptionMd]);
    
    // Update current_version_id
    await db.query(
      'UPDATE job SET current_version_id = $1 WHERE id = $2',
      [result.rows[0].id, jobId]
    );
    
    return result.rows[0].id;
  }

  async createJobLocations(jobId, job) {
    if (!job.location) return;
    
    const locations = Array.isArray(job.location) ? job.location : [job.location];
    
    for (const loc of locations) {
      const { city, region, country } = this.parseLocation(loc);
      await db.query(`
        INSERT INTO job_location (job_id, city, region, country, remote)
        VALUES ($1, $2, $3, $4, $5)
      `, [jobId, city, region, country, job.remote]);
    }
  }

  parseLocation(locationString) {
    if (!locationString) return { city: null, region: null, country: null };

    const parts = locationString.split(',').map(s => s.trim());

    // Many ATS postings (mostly Lever) give a bare country/region/city name
    // with no comma at all, sometimes noise words and other separators
    // mixed in — e.g. "Canada", "India (Remote)", "LATAM", "Remote - US",
    // "SG - Singapore". Without this check the whole string lands in `city`
    // and `country` stays null, which the US-location feed filter treats as
    // "no clear non-US signal" and lets through. Only try this when there's
    // no comma (parts.length === 1) — a genuine "City, Country" pair should
    // keep using the comma-split path below, unchanged.
    if (parts.length === 1) {
      const match = resolveLocationToken(parts[0]);
      if (match) {
        if (match.type === 'country') return { city: null, region: null, country: match.value };
        if (match.type === 'region') return { city: null, region: match.value, country: null };
        return { city: match.value, region: null, country: match.country }; // city
      }
      // No match, but if every token was pure noise (e.g. a broken ATS
      // posting whose "location" is actually its employment-type value,
      // like "Full-time" — see NOISE_WORDS in geo.js) the raw string isn't
      // a real place name either, so don't store it as one.
      if (tokenizeLocation(parts[0]).length === 0) {
        return { city: null, region: null, country: null };
      }
    }

    return {
      city: parts[0] || null,
      region: parts[1] || null,
      country: parts[2] || parts[1] || null,
    };
  }

  hasSignificantChanges(existing, newJob, newDescriptionMd) {
    // Check if description, salary, or valid_through changed
    const descChanged = existing.description_excerpt !== this.createExcerpt(newDescriptionMd, 500);
    const salaryChanged = existing.salary_min !== newJob.salary_min || 
                          existing.salary_max !== newJob.salary_max;
    const validThroughChanged = existing.valid_through !== newJob.valid_through;
    
    return descChanged || salaryChanged || validThroughChanged;
  }

  htmlToMarkdown(html) {
    if (!html) return '';
    try {
      return turndownService.turndown(html);
    } catch (error) {
      logger.warn({ error }, 'Failed to convert HTML to Markdown');
      return html;
    }
  }

  createExcerpt(text, maxLength = 500) {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength 
      ? cleaned.substring(0, maxLength) + '...'
      : cleaned;
  }
}

export default new NormalizerService();