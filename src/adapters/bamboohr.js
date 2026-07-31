import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class BambooHRAdapter extends BaseAdapter {
  constructor() {
    super('bamboohr');
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'bamboohr' }, 'Fetching jobs');

      const url = `https://${org}.bamboohr.com/careers/list`;
      const data = await this.fetch(url);

      const jobs = data.result || [];
      logger.info({ org, count: jobs.length }, 'BambooHR jobs fetched');

      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'BambooHR fetch failed');
      throw error;
    }
  }

  // The list endpoint doesn't include description or a direct apply URL —
  // both are cheap to derive without an extra per-job request.
  normalizeJob(rawJob, org) {
    return {
      provider: 'bamboohr',
      external_id: rawJob.id?.toString(),
      company_domain: `${org}.bamboohr.com`,
      title: rawJob.jobOpeningName,
      apply_url: `https://${org}.bamboohr.com/careers/${rawJob.id}`,
      employment_type: this.parseEmploymentType(rawJob.employmentStatusLabel),
      remote: !!rawJob.isRemote,
      location: [rawJob.location?.city, rawJob.location?.state].filter(Boolean).join(', '),
      posted_at: null, // not present on the list endpoint
      description: '',
      raw: rawJob,
    };
  }

  parseEmploymentType(label) {
    if (!label) return null;
    const v = label.toLowerCase().trim();
    if (v.includes('full')) return 'full_time';
    if (v.includes('part')) return 'part_time';
    if (v.includes('intern') || v.includes('student')) return 'internship';
    if (v.includes('contract') || v.includes('temp')) return 'contract';
    return null;
  }
}

export default BambooHRAdapter;
