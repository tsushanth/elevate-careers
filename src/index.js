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
      
      // Import express for health check endpoint
      const express = (await import('express')).default;
      const healthApp = express();
      
      // Simple health endpoint for Cloud Run
      healthApp.get('/health', (req, res) => {
        res.json({ status: 'healthy', mode: 'worker', timestamp: new Date().toISOString() });
      });

      const HOST = '0.0.0.0';
      
      // Start health check server
      const healthServer = healthApp.listen(config.port, () => {
        logger.info({ port: config.port }, 'Worker health check server started');
      });
      
      // Start the actual worker
      await import('./workers/worker.js');
      
      // Graceful shutdown for worker
      const shutdownWorker = async (signal) => {
        logger.info({ signal }, 'Shutdown signal received');
        healthServer.close(() => {
          logger.info('Health check server closed');
        });
        await db.close();
        process.exit(0);
      };

      process.on('SIGTERM', () => shutdownWorker('SIGTERM'));
      process.on('SIGINT', () => shutdownWorker('SIGINT'));
      
    } else {
      // Start API server
      logger.info('Starting in API mode');
      const app = (await import('./api/server.js')).default;

      const HOST = '0.0.0.0';
      
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