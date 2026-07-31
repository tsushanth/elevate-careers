import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class RecruiteeAdapter extends BaseAdapter {
  constructor() {
    super('recruitee');
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'recruitee' }, 'Fetching jobs');

      const url = `https://${org}.recruitee.com/api/offers/`;
      const data = await this.fetch(url);

      const jobs = data.offers || [];
      logger.info({ org, count: jobs.length }, 'Recruitee jobs fetched');

      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'Recruitee fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    return {
      provider: 'recruitee',
      external_id: rawJob.id?.toString(),
      company_domain: `${org}.recruitee.com`,
      title: rawJob.title,
      apply_url: rawJob.careers_apply_url || rawJob.careers_url,
      employment_type: this.parseEmploymentType(rawJob.employment_type_code),
      remote: !!rawJob.remote,
      location: rawJob.location || rawJob.city,
      posted_at: rawJob.published_at,
      description: rawJob.description || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(code) {
    if (!code) return null;
    // Recruitee codes look like "fulltime_permanent", "parttime_fixed_term"
    if (code.startsWith('fulltime')) return 'full_time';
    if (code.startsWith('parttime')) return 'part_time';
    if (code.includes('internship') || code.includes('intern')) return 'internship';
    if (code.includes('temp') || code.includes('fixed_term') || code.includes('contract')) return 'contract';
    return null;
  }
}

export default RecruiteeAdapter;
