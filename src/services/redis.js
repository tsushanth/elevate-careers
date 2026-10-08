// Dedicated client for the feed cache. Fails fast (short timeouts, no offline
// queue) so a slow Redis can never hold up a feed request.
import Redis from 'ioredis';
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

let client;

// Redis down => ioredis emits 'error' on every reconnect attempt. Log at most
// one line per intervalMs and report how many were suppressed in between.
export function createThrottledWarn(log, intervalMs = 30_000, now = Date.now) {
  let last = -Infinity;
  let suppressed = 0;
  return (fields, msg) => {
    const t = now();
    if (t - last < intervalMs) { suppressed++; return; }
    last = t;
    const extra = suppressed ? { suppressed } : {};
    suppressed = 0;
    log.warn({ ...fields, ...extra }, msg);
  };
}

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
  const warn = createThrottledWarn(logger);
  client.on('error', (e) => warn({ error: e.message }, 'feed cache redis error'));
  return client;
}
