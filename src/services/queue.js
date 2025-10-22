import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  tls: config.redis.tls,
  maxRetriesPerRequest: null,
});

connection.on('connect', () => {
  logger.info('Redis connected');
});

connection.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

// Job Queue
export const jobQueue = new Queue('job-ingestion', {
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

export async function enqueueJob(jobType, data) {
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

export { connection };