import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class LeverAdapter extends BaseAdapter {
  constructor() {
    super('lever');
    this.baseUrl = 'https://api.lever.co/v0/postings';
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'lever' }, 'Fetching jobs');
      
      const url = `${this.baseUrl}/${org}?mode=json`;
      const jobs = await this.fetch(url);
      
      logger.info({ org, count: jobs.length }, 'Lever jobs fetched');
      
      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'Lever fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    const locations = rawJob.categories?.location 
      ? (Array.isArray(rawJob.categories.location) 
          ? rawJob.categories.location 
          : [rawJob.categories.location])
      : [];
    
    const commitment = rawJob.categories?.commitment || '';
    
    return {
      provider: 'lever',
      external_id: rawJob.id,
      company_domain: `${org}.lever.co`,
      title: rawJob.text,
      apply_url: rawJob.hostedUrl || rawJob.applyUrl,
      employment_type: this.parseEmploymentType(commitment),
      remote: this.isRemote(locations),
      location: locations[0] || null,
      posted_at: rawJob.createdAt ? new Date(rawJob.createdAt).toISOString() : null,
      description: rawJob.description || rawJob.descriptionPlain || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(commitment) {
    if (!commitment) return null;
    const normalized = commitment.toLowerCase();
    if (normalized.includes('full')) return 'full_time';
    if (normalized.includes('part')) return 'part_time';
    if (normalized.includes('contract')) return 'contract';
    if (normalized.includes('intern')) return 'internship';
    return null;
  }

  isRemote(locations) {
    return locations.some(loc => 
      loc.toLowerCase().includes('remote') || 
      loc.toLowerCase().includes('anywhere')
    );
  }
}

export default LeverAdapter;