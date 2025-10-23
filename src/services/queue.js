import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

let connection = null;
let jobQueue = null;

// Only initialize Redis if host is not localhost
if (config.redis.host && config.redis.host !== 'localhost') {
  connection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    tls: config.redis.tls,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > 3) {
        logger.warn('Redis connection failed after 3 retries, disabling queue');
        return null; // Stop retrying
      }
      return Math.min(times * 1000, 3000);
    },
  });

  connection.on('connect', () => {
    logger.info('Redis connected');
  });

  connection.on('error', (err) => {
    logger.warn({ error: err.message }, 'Redis connection error - queue disabled');
  });

  // Job Queue
  jobQueue = new Queue('job-ingestion', {
    connection,
    defaultJobOptions: {
      attempts: config.queue.maxRetries,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  
  logger.info('Job queue initialized');
} else {
  logger.info('Redis not configured (localhost), queue disabled');
}

export async function enqueueJob(jobType, data) {
  if (!jobQueue) {
    logger.warn({ jobType, data }, 'Queue not available - Redis not configured');
    return { 
      id: 'no-queue', 
      message: 'Job queue not configured. Set up Redis + Worker to enable job processing.',
      note: 'API endpoints work, but job ingestion requires Redis'
    };
  }
  
  try {
    const job = await jobQueue.add(jobType, data, {
      jobId: `${jobType}-${data.provider}-${data.org}-${Date.now()}`,
    });
    logger.info({ jobId: job.id, jobType, data }, 'Job enqueued');
    return job;
  } catch (error) {
    logger.error({ error, jobType, data }, 'Failed to enqueue job');
    throw error;
  }
}

export function createWorker(processor) {
  if (!connection) {
    throw new Error('Redis connection not available. Cannot create worker.');
  }
  
  const worker = new Worker('job-ingestion', processor, {
    connection,
    concurrency: config.queue.concurrency,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  return worker;
}

export { jobQueue, connection };