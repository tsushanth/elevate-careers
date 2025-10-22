import pkg from 'pg';
const { Pool } = pkg;
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      min: config.database.poolMin,
      max: config.database.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database pool error');
    });

    this.pool.on('connect', () => {
      logger.debug('New database connection established');
    });
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug({ text, duration, rows: result.rowCount }, 'Executed query');
      return result;
    } catch (error) {
      logger.error({ error, text, params }, 'Database query error');
      throw error;
    }
  }

  async getClient() {
    return await this.pool.query();
  }

  async close() {
    await this.pool.end();
    logger.info('Database pool closed');
  }

  async healthCheck() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      return false;
    }
  }
}

export const db = new Database();
export default db;