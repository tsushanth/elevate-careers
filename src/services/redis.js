// Dedicated client for the feed cache. Fails fast (short timeouts, no offline
// queue) so a slow Redis can never hold up a feed request.
import Redis from 'ioredis';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

let client;

export function getRedis() {
  if (client !== undefined) return client;
  if (!config.redis.host || config.redis.host === 'localhost') { client = null; return client; }
  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    tls: config.redis.tls,
    connectTimeout: 1000,
    commandTimeout: 250,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', (e) => logger.warn({ error: e.message }, 'feed cache redis error'));
  return client;
}
