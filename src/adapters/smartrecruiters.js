import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class SmartRecruitersAdapter extends BaseAdapter {
  constructor() {
    super('smartrecruiters');
  }

  async fetchJobs(org) {
    try {
      logger.info({ org, provider: 'smartrecruiters' }, 'Fetching jobs');
      
      const url = `https://api.smartrecruiters.com/v1/companies/${org}/postings`;
      const data = await this.fetch(url);
      
      const jobs = data.content || [];
      logger.info({ org, count: jobs.length }, 'SmartRecruiters jobs fetched');
      
      return jobs.map(job => this.normalizeJob(job, org));
    } catch (error) {
      logger.error({ error, org }, 'SmartRecruiters fetch failed');
      throw error;
    }
  }

  normalizeJob(rawJob, org) {
    const employmentType = this.parseEmploymentType(rawJob);
    
    logger.debug({
      jobId: rawJob.id,
      title: rawJob.name,
      rawTypeOfEmployment: rawJob.typeOfEmployment,
      extractedEmploymentType: employmentType
    }, 'Normalizing SmartRecruiters job');
    
    return {
      provider: 'smartrecruiters',
      external_id: rawJob.id,
      company_domain: `${org}.smartrecruiters.com`,
      title: rawJob.name,
      apply_url: rawJob.refNumber 
        ? `https://jobs.smartrecruiters.com/${org}/${rawJob.refNumber}`
        : `https://jobs.smartrecruiters.com/${org}`,
      employment_type: employmentType,
      remote: this.isRemote(rawJob),
      location: this.parseLocation(rawJob.location),
      posted_at: rawJob.releasedDate || rawJob.createdOn,
      description: rawJob.jobAd?.sections?.jobDescription?.text || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(job) {
    // SmartRecruiters uses typeOfEmployment field
    if (!job.typeOfEmployment) {
      logger.debug({ jobId: job.id }, 'No typeOfEmployment found');
      return null;
    }
    
    const type = job.typeOfEmployment.toLowerCase().trim();
    
    const mapping = {
      'full time': 'full_time',
      'full-time': 'full_time',
      'fulltime': 'full_time',
      'full_time': 'full_time',
      'permanent': 'full_time',
      
      'part time': 'part_time',
      'part-time': 'part_time',
      'parttime': 'part_time',
      'part_time': 'part_time',
      
      'contract': 'contract',
      'contractor': 'contract',
      'temporary': 'contract',
      'temp': 'contract',
      
      'internship': 'internship',
      'intern': 'internship',
      'co-op': 'internship',
    };
    
    const result = mapping[type];
    
    if (!result) {
      logger.warn({ 
        originalType: job.typeOfEmployment, 
        normalized: type 
      }, 'Unable to map SmartRecruiters employment type');
      return null;
    }
    
    return result;
  }

  parseLocation(location) {
    if (!location) return null;
    
    const parts = [
      location.city,
      location.region,
      location.country
    ].filter(Boolean);
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  isRemote(job) {
    // Check remote field
    if (job.remote === true) return true;
    
    // Check location
    const location = this.parseLocation(job.location) || '';
    return location.toLowerCase().includes('remote');
  }
}

export default SmartRecruitersAdapter;