import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const REDIS_KEY_PREFIX = 'kenmei:';

/**
 * Shared Redis instance for the application.
 * Configured with a key prefix for namespacing and robust retry strategy.
 */
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  lazyConnect: false, // Connect immediately
  connectTimeout: 10000, // 10 second timeout
  retryStrategy: (times) => {
    // Exponential backoff with a cap
    const delay = Math.min(times * 200, 5000);
    if (times > 10) {
      console.warn('[Redis] Warning: Redis is currently unreachable. Retrying in background...');
      return delay;
    }
    return delay;
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some(e => err.message.includes(e));
  },
});

redis.on('error', (err) => {
  // Silent standard connection errors to avoid flooding logs
  if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
    return;
  }
  console.error('[Redis] Unexpected error:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] Connection initialized');
});

redis.on('close', () => {
  console.log('[Redis] Connection closed');
});

redis.on('ready', () => {
  console.log('[Redis] Ready to accept commands');
});

/**
 * Check if Redis is currently connected and responsive.
 * Uses the actual redis.status which is authoritative.
 */
export function isRedisAvailable(): boolean {
  const status = redis.status;
  return status === 'ready';
}

/**
 * Wait for Redis to be ready (with timeout).
 * Useful for initial connection establishment in serverless environments.
 */
export async function waitForRedis(timeoutMs: number = 3000): Promise<boolean> {
  const status = redis.status;
  
  // Already ready
  if (status === 'ready') {
    return true;
  }
  
  // Already failed/closed - not going to recover
  if (status === 'end' || status === 'close') {
    console.log('[Redis] waitForRedis: Connection ended/closed, returning false');
    return false;
  }
  
  // Wait for ready event or timeout
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[Redis] waitForRedis: Timeout waiting for ready state (status=%s)', redis.status);
      resolve(false);
    }, timeoutMs);
    
    const onReady = () => {
      clearTimeout(timeout);
      redis.off('error', onError);
      resolve(true);
    };
    
    const onError = () => {
      clearTimeout(timeout);
      redis.off('ready', onReady);
      resolve(false);
    };
    
    redis.once('ready', onReady);
    redis.once('error', onError);
  });
}

/**
 * Check if workers are online by checking for a heartbeat key in Redis.
 * Workers should set this key periodically.
 * This function will wait briefly for Redis to connect if needed.
 */
export async function areWorkersOnline(): Promise<boolean> {
  // Wait for Redis to be ready (up to 3 seconds)
  const redisReady = await waitForRedis(3000);
  
  if (!redisReady) {
    console.log('[Redis] areWorkersOnline: Redis not ready after waiting (status=%s)', redis.status);
    return false;
  }
  
  try {
    const heartbeat = await redis.get(`${REDIS_KEY_PREFIX}workers:heartbeat`);
    
    if (!heartbeat) {
      console.log('[Redis] areWorkersOnline: No heartbeat key found - workers offline');
      return false;
    }
    
    // Heartbeat is valid if it's less than 15 seconds old
    const lastBeat = parseInt(heartbeat, 10);
    const now = Date.now();
    const age = now - lastBeat;
    const isValid = age < 15000; // 15 seconds
    
    console.log('[Redis] areWorkersOnline: Heartbeat age=%dms, isValid=%s', age, isValid);
    
    return isValid;
  } catch (err) {
    console.error('[Redis] Error checking worker heartbeat:', err);
    return false;
  }
}

/**
 * Set worker heartbeat (called by worker process)
 * Sets key with 10 second TTL, called every 5 seconds by workers
 */
export async function setWorkerHeartbeat(): Promise<void> {
  try {
    await redis.set(`${REDIS_KEY_PREFIX}workers:heartbeat`, Date.now().toString(), 'EX', 10);
    console.log('[Workers] Heartbeat updated');
    console.log('[Workers] Heartbeat sent');
  } catch (err) {
    console.error('[Redis] Error setting worker heartbeat:', err);
  }
}

/**
 * Safely disconnects from Redis, ensuring all pending commands are processed.
 */
export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end') return;
  
  try {
    await redis.quit();
    console.log('[Redis] Disconnected');
  } catch (err) {
    console.error('[Redis] Error during disconnect:', err);
    redis.disconnect(); // Force disconnect if quit fails
  }
}
