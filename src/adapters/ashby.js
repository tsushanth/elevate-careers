import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class AshbyAdapter extends BaseAdapter {
  constructor() {
    super('ashby');
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'ashby' }, 'Fetching jobs');
      
      const url = `https://jobs.ashbyhq.com/${org}`;
      const html = await this.fetch(url);
      
      // Ashby embeds job data in a script tag
      const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
      if (!match) {
        throw new Error('Could not find job data in Ashby page');
      }
      
      const data = JSON.parse(match[1]);
      const jobs = data.jobs || [];
      
      logger.info({ org, count: jobs.length }, 'Ashby jobs fetched');
      
      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'Ashby fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    const employmentType = this.parseEmploymentType(rawJob);
    
    logger.debug({
      jobId: rawJob.id,
      title: rawJob.title,
      rawEmploymentType: rawJob.employmentType,
      extractedEmploymentType: employmentType
    }, 'Normalizing Ashby job');
    
    return {
      provider: 'ashby',
      external_id: rawJob.id,
      company_domain: `${org}.ashbyhq.com`,
      title: rawJob.title,
      apply_url: rawJob.jobUrl || `https://jobs.ashbyhq.com/${org}/${rawJob.id}`,
      employment_type: employmentType,
      remote: this.isRemote(rawJob),
      location: rawJob.locationName || rawJob.location,
      posted_at: rawJob.publishedDate,
      description: rawJob.descriptionHtml || rawJob.description || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(job) {
    // Ashby can have employmentType field or it might be in metadata
    const type = job.employmentType || job.metadata?.employmentType;
    
    if (!type) {
      logger.debug({ jobId: job.id }, 'No employment type found in Ashby job');
      return null;
    }
    
    const normalized = type.toLowerCase().trim();
    
    const mapping = {
      'fulltime': 'full_time',
      'full-time': 'full_time',
      'full time': 'full_time',
      'full_time': 'full_time',
      'permanent': 'full_time',
      
      'parttime': 'part_time',
      'part-time': 'part_time',
      'part time': 'part_time',
      'part_time': 'part_time',
      
      'contract': 'contract',
      'contractor': 'contract',
      'temporary': 'contract',
      
      'internship': 'internship',
      'intern': 'internship',
      'co-op': 'internship',
    };
    
    const result = mapping[normalized];
    
    if (!result) {
      logger.warn({ 
        originalType: type, 
        normalized 
      }, 'Unable to map Ashby employment type');
      return null;
    }
    
    return result;
  }

  isRemote(job) {
    // Check isRemote field
    if (job.isRemote === true) return true;
    
    // Check location name
    const location = (job.locationName || job.location || '').toLowerCase();
    return location.includes('remote') || location.includes('anywhere');
  }
}

export default AshbyAdapter;