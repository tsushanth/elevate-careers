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
    
    return {
      provider: 'jsonld',
      external_id: rawJob.identifier?.value || null,
      company_domain: this.extractDomain(sourceUrl),
      title: rawJob.title,
      apply_url: rawJob.url || sourceUrl,
      employment_type: this.parseEmploymentType(rawJob.employmentType),
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

  parseLocation(jobLocation) {
    if (!jobLocation) return null;
    if (Array.isArray(jobLocation)) jobLocation = jobLocation[0];
    
    const address = jobLocation.address;
    if (!address) return null;
    
    return [
      address.addressLocality,
      address.addressRegion,
      address.addressCountry
    ].filter(Boolean).join(', ');
  }

  isRemote(job) {
    const applicantLocation = job.applicantLocationRequirements;
    const jobLocation = job.jobLocation;
    
    if (applicantLocation?.name?.toLowerCase().includes('remote')) return true;
    if (jobLocation?.name?.toLowerCase().includes('remote')) return true;
    if (job.jobLocationType === 'TELECOMMUTE') return true;
    
    return false;
  }

  parseEmploymentType(type) {
    if (!type) return null;
    const normalized = type.toLowerCase();
    if (normalized.includes('full')) return 'full_time';
    if (normalized.includes('part')) return 'part_time';
    if (normalized.includes('contract')) return 'contract';
    if (normalized.includes('intern')) return 'internship';
    return null;
  }

  parseSalary(baseSalary) {
    if (!baseSalary) return null;
    
    const value = baseSalary.value;
    if (!value) return null;

    return {
      min: value.minValue,
      max: value.maxValue,
      currency: value.currency || baseSalary.currency,
    };
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