import crypto from 'crypto';
import TurndownService from 'turndown';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const turndownService = new TurndownService();

export class NormalizerService {
  
  async processJobs(jobs, provider, org) {
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (const rawJob of jobs) {
      try {
        await this.processJob(rawJob, provider, org);
        results.created++;
      } catch (error) {
        logger.error({ error, rawJob }, 'Failed to process job');
        results.errors.push({ job: rawJob.title, error: error.message });
      }
    }

    return results;
  }

  async processJob(rawJob, provider, org) {
    // Generate dedupe key
    const dedupeKey = this.generateDedupeKey(rawJob);
    
    // Get or create company
    const company = await this.getOrCreateCompany(rawJob.company_domain || `${org}.${provider}.io`);
    
    // Convert HTML to Markdown
    const descriptionMd = this.htmlToMarkdown(rawJob.description);
    const descriptionExcerpt = this.createExcerpt(descriptionMd, 500);
    
    // Check if job exists
    const existing = await this.findExistingJob(dedupeKey);
    
    if (existing) {
      // Check if significant fields changed
      if (this.hasSignificantChanges(existing, rawJob, descriptionMd)) {
        await this.updateJob(existing, rawJob, company.id, descriptionMd, descriptionExcerpt);
        await this.createJobVersion(existing.id, descriptionMd);
      }
    } else {
      // Create new job
      const jobId = await this.createJob(rawJob, company.id, dedupeKey, descriptionMd, descriptionExcerpt);
      await this.createJobVersion(jobId, descriptionMd);
      await this.createJobLocations(jobId, rawJob);
    }
    
    return dedupeKey;
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

  async getOrCreateCompany(domain) {
    const result = await db.query(
      'SELECT * FROM company WHERE domain = $1',
      [domain]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    
    // Extract company name from domain
    const name = domain.split('.')[0].replace(/-/g, ' ');
    
    const insert = await db.query(
      'INSERT INTO company (name, domain) VALUES ($1, $2) RETURNING *',
      [name, domain]
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
        to_tsvector('english', $5 || ' ' || COALESCE($13, ''))
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
        tsv = to_tsvector('english', $3 || ' ' || COALESCE($10, '')),
        updated_at = now()
      WHERE id = $11
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