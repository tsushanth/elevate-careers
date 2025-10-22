import config from './config/index.js';
import { logger } from './utils/logger.js';
import { db } from './db/index.js';

async function startServer() {
  try {
    // Test database connection
    const dbHealthy = await db.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('Database connected successfully');

    if (config.serviceMode === 'worker') {
      // Start worker
      logger.info('Starting in WORKER mode');
      await import('./workers/worker.js');
    } else {
      // Start API server
      logger.info('Starting in API mode');
      const app = (await import('./api/server.js')).default;
      
      const server = app.listen(config.port, () => {
        logger.info({ 
          port: config.port, 
          env: config.nodeEnv 
        }, 'API server started');
      });

      // Graceful shutdown
      const shutdown = async (signal) => {
        logger.info({ signal }, 'Shutdown signal received');
        
        server.close(async () => {
          logger.info('HTTP server closed');
          await db.close();
          process.exit(0);
        });

        // Force shutdown after 10 seconds
        setTimeout(() => {
          logger.error('Forcing shutdown after timeout');
          process.exit(1);
        }, 10000);
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    }
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}


startServer();