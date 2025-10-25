import { BaseAdapter } from './base.js';
import { load } from 'cheerio';
import { logger } from '../utils/logger.js';

export class JSONLDAdapter extends BaseAdapter {
  constructor() {
    super('jsonld');
  }

  async fetchJobs(url) {
    try {
      logger.info({ url, provider: 'jsonld' }, 'Fetching jobs');
      
      const html = await this.fetch(url);
      const $ = load(html);
      const jobs = [];

      $('script[type="application/ld+json"]').each((_, element) => {
        try {
          const json = JSON.parse($(element).html());
          if (this.isJobPosting(json)) {
            jobs.push(this.normalizeJob(json, url));
          } else if (Array.isArray(json)) {
            json.forEach(item => {
              if (this.isJobPosting(item)) {
                jobs.push(this.normalizeJob(item, url));
              }
            });
          }
        } catch (error) {
          logger.warn({ error, url }, 'Failed to parse JSON-LD');
        }
      });

      logger.info({ url, count: jobs.length }, 'JSON-LD jobs extracted');
      return jobs;
    } catch (error) {
      logger.error({ error, url }, 'JSON-LD fetch failed');
      throw error;
    }
  }

  isJobPosting(json) {
    return json['@type'] === 'JobPosting' || 
           (Array.isArray(json['@type']) && json['@type'].includes('JobPosting'));
  }

  normalizeJob(rawJob, sourceUrl) {
    const hiringOrg = rawJob.hiringOrganization || {};
    const location = this.parseLocation(rawJob.jobLocation);
    const employmentType = this.parseEmploymentType(rawJob.employmentType);
    
    logger.debug({
      title: rawJob.title,
      rawEmploymentType: rawJob.employmentType,
      normalizedEmploymentType: employmentType
    }, 'Normalizing JSON-LD job');
    
    return {
      provider: 'jsonld',
      external_id: rawJob.identifier?.value || this.generateExternalId(rawJob, sourceUrl),
      company_domain: this.extractDomain(sourceUrl),
      title: rawJob.title,
      apply_url: rawJob.url || sourceUrl,
      employment_type: employmentType,
      remote: this.isRemote(rawJob),
      location: location,
      posted_at: rawJob.datePosted,
      valid_through: rawJob.validThrough,
      salary_min: this.parseSalary(rawJob.baseSalary)?.min,
      salary_max: this.parseSalary(rawJob.baseSalary)?.max,
      salary_currency: this.parseSalary(rawJob.baseSalary)?.currency,
      description: rawJob.description || '',
      raw: rawJob,
    };
  }

  generateExternalId(job, sourceUrl) {
    // Generate a consistent ID from job details if identifier is missing
    const hash = require('crypto').createHash('md5');
    hash.update(`${sourceUrl}-${job.title}-${job.datePosted || ''}`);
    return hash.digest('hex');
  }

  parseLocation(jobLocation) {
    if (!jobLocation) return null;
    if (Array.isArray(jobLocation)) jobLocation = jobLocation[0];
    
    const address = jobLocation.address;
    if (!address) return jobLocation.name || null;
    
    return [
      address.addressLocality,
      address.addressRegion,
      address.addressCountry
    ].filter(Boolean).join(', ');
  }

  isRemote(job) {
    // Check jobLocationType first (most explicit)
    if (job.jobLocationType === 'TELECOMMUTE') return true;
    
    // Check applicantLocationRequirements
    const applicantLocation = job.applicantLocationRequirements;
    if (applicantLocation) {
      const locationName = applicantLocation.name?.toLowerCase() || '';
      if (locationName.includes('remote') || locationName.includes('anywhere')) {
        return true;
      }
    }
    
    // Check jobLocation
    const jobLocation = job.jobLocation;
    if (jobLocation) {
      const locationName = jobLocation.name?.toLowerCase() || '';
      if (locationName.includes('remote') || locationName.includes('anywhere')) {
        return true;
      }
    }
    
    return false;
  }

  parseEmploymentType(type) {
    if (!type) {
      logger.debug('No employment type provided');
      return null;
    }
    
    // Handle array of types (take first one)
    if (Array.isArray(type)) {
      if (type.length === 0) return null;
      type = type[0];
    }
    
    // Convert to lowercase and remove special characters
    const normalized = type.toString().toLowerCase().trim();
    
    // JSON-LD typically uses values like:
    // "FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"
    // But some sites use custom values, so we need flexible matching
    
    const mapping = {
      // Full-time variations
      'full_time': 'full_time',
      'fulltime': 'full_time',
      'full-time': 'full_time',
      'full time': 'full_time',
      'permanent': 'full_time',
      
      // Part-time variations
      'part_time': 'part_time',
      'parttime': 'part_time',
      'part-time': 'part_time',
      'part time': 'part_time',
      
      // Contract variations
      'contract': 'contract',
      'contractor': 'contract',
      'temporary': 'contract',
      'temp': 'contract',
      'per_diem': 'contract',
      'per diem': 'contract',
      
      // Internship variations
      'internship': 'internship',
      'intern': 'internship',
      'co-op': 'internship',
      'coop': 'internship',
    };
    
    // Check exact match first
    if (mapping[normalized]) {
      return mapping[normalized];
    }
    
    // Check if normalized string contains any of our keywords
    if (normalized.includes('full')) return 'full_time';
    if (normalized.includes('part')) return 'part_time';
    if (normalized.includes('contract') || normalized.includes('temporary')) return 'contract';
    if (normalized.includes('intern')) return 'internship';
    
    // If we can't map it, log for investigation and return null
    logger.warn({ originalType: type, normalized }, 'Unable to map employment type to standard value');
    return null;
  }

  parseSalary(baseSalary) {
    if (!baseSalary) return null;
    
    // Handle MonetaryAmount schema
    const value = baseSalary.value;
    if (value) {
      return {
        min: value.minValue || null,
        max: value.maxValue || null,
        currency: value.currency || baseSalary.currency || 'USD',
      };
    }
    
    // Handle direct values (some sites don't use nested value object)
    if (baseSalary.minValue || baseSalary.maxValue) {
      return {
        min: baseSalary.minValue || null,
        max: baseSalary.maxValue || null,
        currency: baseSalary.currency || 'USD',
      };
    }
    
    return null;
  }

  extractDomain(url) {
    try {
      const domain = new URL(url).hostname;
      return domain.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}

export default JSONLDAdapter;