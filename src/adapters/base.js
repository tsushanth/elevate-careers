import axios from 'axios';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

export class BaseAdapter {
  constructor(name) {
    this.name = name;
    this.client = axios.create({
      timeout: config.ingestion.fetchTimeout,
      headers: {
        'User-Agent': 'JobAggregator/1.0',
      },
    });
  }

  async fetch(url, options = {}) {
    try {
      logger.debug({ url, adapter: this.name }, 'Fetching data');
      const response = await this.client.get(url, options);
      return response.data;
    } catch (error) {
      logger.error({ error, url, adapter: this.name }, 'Fetch error');
      throw error;
    }
  }

  async post(url, body = {}, options = {}) {
    try {
      logger.debug({ url, adapter: this.name }, 'Posting data');
      const response = await this.client.post(url, body, options);
      return response.data;
    } catch (error) {
      logger.error({ error, url, adapter: this.name }, 'Post error');
      throw error;
    }
  }

  async fetchJobs(org) {
    throw new Error(`fetchJobs not implemented for ${this.name}`);
  }

  normalizeJob(rawJob) {
    throw new Error(`normalizeJob not implemented for ${this.name}`);
  }
}

export default BaseAdapter;