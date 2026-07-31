import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class WorkableAdapter extends BaseAdapter {
  constructor() {
    super('workable');
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'workable' }, 'Fetching jobs');

      const listUrl = `https://apply.workable.com/api/v3/accounts/${org}/jobs`;
      const data = await this.post(listUrl, {});
      const jobs = data.results || [];
      logger.info({ org, count: jobs.length }, 'Workable jobs listed');

      // The list endpoint has no description — fetch each job's detail.
      // Sequential and capped: most companies have a handful of postings,
      // but this avoids pathological fan-out for the rare large board.
      const capped = jobs.slice(0, 100);
      const detailed = [];
      for (const job of capped) {
        try {
          const detail = await this.fetch(
            `https://apply.workable.com/api/v1/accounts/${org}/jobs/${job.shortcode}`
          );
          detailed.push(this.normalizeJob({ ...job, ...detail }, org));
        } catch (e) {
          logger.warn({ org, shortcode: job.shortcode }, 'Workable job detail fetch failed, using list data only');
          detailed.push(this.normalizeJob(job, org));
        }
      }
      return detailed;
    } catch (error) {
      logger.error({ error, org }, 'Workable fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    return {
      provider: 'workable',
      external_id: rawJob.shortcode,
      company_domain: `apply.workable.com/${org}`,
      title: rawJob.title,
      apply_url: `https://apply.workable.com/${org}/j/${rawJob.shortcode}/`,
      employment_type: this.parseEmploymentType(rawJob.type),
      remote: !!rawJob.remote || rawJob.workplace === 'remote',
      location: [rawJob.location?.city, rawJob.location?.region || rawJob.location?.country].filter(Boolean).join(', '),
      posted_at: rawJob.published,
      description: rawJob.description || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(type) {
    const mapping = {
      full: 'full_time',
      part: 'part_time',
      contract: 'contract',
      temporary: 'contract',
      internship: 'internship',
    };
    return mapping[type] || null;
  }
}

export default WorkableAdapter;
