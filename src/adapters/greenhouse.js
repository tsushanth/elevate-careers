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
    const employmentType = this.parseEmploymentType(rawJob.metadata);
    
    logger.debug({ 
      jobId: rawJob.id, 
      title: rawJob.title,
      metadata: rawJob.metadata,
      extractedEmploymentType: employmentType 
    }, 'Normalizing Greenhouse job');
    
    return {
      provider: 'greenhouse',
      external_id: rawJob.id?.toString(),
      company_domain: `${org}.greenhouse.io`,
      title: rawJob.title,
      apply_url: rawJob.absolute_url,
      employment_type: employmentType,
      remote: this.isRemote(rawJob.location),
      location: rawJob.location?.name,
      posted_at: rawJob.updated_at,
      description: rawJob.content || '',
      raw: rawJob,
    };
  }

  parseEmploymentType(metadata) {
    if (!metadata || !Array.isArray(metadata)) {
      logger.warn('No metadata array found for employment type parsing');
      return null;
    }
    
    // Look for Employment Type in metadata
    const employmentTypeField = metadata.find(m => 
      m.name && m.name.toLowerCase().includes('employment') && 
      m.name.toLowerCase().includes('type')
    );
    
    if (!employmentTypeField || !employmentTypeField.value) {
      logger.warn({ metadata }, 'Employment Type not found in metadata');
      return null;
    }
    
    const value = employmentTypeField.value.toLowerCase().trim();
    
    // Normalize to standard values
    const mapping = {
      'full time': 'full_time',
      'fulltime': 'full_time',
      'full-time': 'full_time',
      'part time': 'part_time',
      'parttime': 'part_time',
      'part-time': 'part_time',
      'contract': 'contract',
      'contractor': 'contract',
      'temporary': 'contract',
      'temp': 'contract',
      'internship': 'internship',
      'intern': 'internship',
    };
    
    const normalized = mapping[value] || value.replace(/\s+/g, '_').replace(/-/g, '_');
    
    logger.debug({ 
      original: employmentTypeField.value, 
      normalized 
    }, 'Employment type parsed');
    
    return normalized;
  }

  isRemote(location) {
    if (!location?.name) return false;
    const remoteName = location.name.toLowerCase();
    return remoteName.includes('remote') || remoteName.includes('anywhere');
  }
}

export default GreenhouseAdapter;