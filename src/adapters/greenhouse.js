import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class GreenhouseAdapter extends BaseAdapter {
  constructor() {
    super('greenhouse');
    this.baseUrl = 'https://boards-api.greenhouse.io/v1/boards';
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'greenhouse' }, 'Fetching jobs');
      
      const url = `${this.baseUrl}/${org}/jobs?content=true`;
      const data = await this.fetch(url);
      
      const jobs = data.jobs || [];
      logger.info({ org, count: jobs.length }, 'Greenhouse jobs fetched');
      
      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'Greenhouse fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    return {
      provider: 'greenhouse',
      external_id: rawJob.id?.toString(),
      company_domain: `${org}.greenhouse.io`,
      title: rawJob.title,
      apply_url: rawJob.absolute_url,
      employment_type: this.parseEmploymentType(rawJob.metadata),
      remote: this.isRemote(rawJob.location),
      location: rawJob.location?.name,
      posted_at: rawJob.updated_at,
      description: rawJob.content || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(metadata) {
    if (!metadata) return null;
    const types = metadata.find(m => m.name === 'Employment Type');
    return types?.value?.toLowerCase()?.replace(/\s+/g, '_');
  }

  isRemote(location) {
    if (!location?.name) return false;
    const remoteName = location.name.toLowerCase();
    return remoteName.includes('remote') || remoteName.includes('anywhere');
  }
}

export default GreenhouseAdapter;