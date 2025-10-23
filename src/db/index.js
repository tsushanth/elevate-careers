import pkg from 'pg';
const { Pool } = pkg;
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

class Database {
  constructor() {
    // Log connection attempt (mask password)
    const maskedUrl = config.database.url.replace(/:([^:@]+)@/, ':***@');
    logger.info({ connectionString: maskedUrl }, 'Initializing database connection');
    
    this.pool = new Pool({
      connectionString: config.database.url,
      min: config.database.poolMin,
      max: config.database.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error({ 
        error: err.message,
        code: err.code 
      }, 'Unexpected database pool error');
      console.error('Pool error:', err);
    });

    this.pool.on('connect', () => {
      logger.info('New database connection established');
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
      logger.error({ 
        error: error.message, 
        code: error.code,
        text, 
        params 
      }, 'Database query error');
      console.error('Query error details:', error);
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
      logger.error({ 
        error: error.message,
        code: error.code,
        detail: error.detail,
        stack: error.stack 
      }, 'Database health check failed');
      console.error('Full database error:', error);
      return false;
    }
  }
}

export const db = new Database();
export default db;