import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  serviceMode: process.env.SERVICE_MODE || 'api', // 'api' or 'worker'
  
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/jobdb',
    poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },
  
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
  },
  
  ingestion: {
    fetchTimeout: parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10),
    maxJobsPerCompany: parseInt(process.env.MAX_JOBS_PER_COMPANY || '1000', 10),
  },
  
  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    region: process.env.GCP_REGION || 'us-central1',
  },
};

export default config;