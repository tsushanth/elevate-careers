import { createWorker } from '../services/queue.js';
import getAdapter from '../adapters/index.js';
import normalizer from '../services/normalizer.js';
import { logger } from '../utils/logger.js';

async function processJob(job) {
  const { provider, org, url } = job.data;
  
  logger.info({ jobId: job.id, provider, org }, 'Processing job');
  
  try {
    // Get the appropriate adapter
    const adapter = getAdapter(provider);
    
    // Fetch jobs from the source
    let rawJobs;
    if (provider === 'jsonld') {
      rawJobs = await adapter.fetchJobs(url);
    } else {
      rawJobs = await adapter.fetchJobs(org);
    }
    
    logger.info({ 
      jobId: job.id, 
      provider, 
      org, 
      count: rawJobs.length 
    }, 'Jobs fetched');
    
    // Normalize and store jobs
    const results = await normalizer.processJobs(rawJobs, provider, org);
    
    logger.info({ 
      jobId: job.id, 
      provider, 
      org, 
      results 
    }, 'Job processing completed');
    
    return results;
  } catch (error) {
    logger.error({ 
      jobId: job.id, 
      provider, 
      org, 
      error 
    }, 'Job processing failed');
    throw error;
  }
}

// Start worker
const worker = createWorker(processJob);

logger.info('Worker started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});

export { worker, processJob };