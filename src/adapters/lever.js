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
      const data = await this.fetch(url);
      
      const jobs = Array.isArray(data) ? data : [];
      logger.info({ org, count: jobs.length }, 'Lever jobs fetched');
      
      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'Lever fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    const employmentType = this.parseEmploymentType(rawJob.categories);
    
    logger.debug({
      jobId: rawJob.id,
      title: rawJob.text,
      categories: rawJob.categories,
      extractedEmploymentType: employmentType
    }, 'Normalizing Lever job');
    
    return {
      provider: 'lever',
      external_id: rawJob.id,
      company_domain: `${org}.lever.co`,
      title: rawJob.text,
      apply_url: rawJob.hostedUrl,
      employment_type: employmentType,
      remote: this.isRemote(rawJob.categories),
      location: rawJob.categories?.location,
      posted_at: new Date(rawJob.createdAt).toISOString(),
      description: rawJob.description || rawJob.descriptionPlain || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(categories) {
    if (!categories || !categories.commitment) {
      logger.debug({ categories }, 'No commitment category found');
      return null;
    }
    
    const commitment = categories.commitment.toLowerCase().trim();
    
    const mapping = {
      'full-time': 'full_time',
      'full time': 'full_time',
      'fulltime': 'full_time',
      'permanent': 'full_time',
      
      'part-time': 'part_time',
      'part time': 'part_time',
      'parttime': 'part_time',
      
      'contract': 'contract',
      'contractor': 'contract',
      'temporary': 'contract',
      'temp': 'contract',
      
      'internship': 'internship',
      'intern': 'internship',
      'co-op': 'internship',
    };
    
    const normalized = mapping[commitment];
    
    if (!normalized) {
      logger.warn({ 
        originalCommitment: categories.commitment, 
        normalized: commitment 
      }, 'Unable to map Lever commitment to standard employment type');
      return null;
    }
    
    return normalized;
  }

  isRemote(categories) {
    if (!categories?.location) return false;
    const location = categories.location.toLowerCase();
    return location.includes('remote') || location.includes('anywhere');
  }
}

export default LeverAdapter;