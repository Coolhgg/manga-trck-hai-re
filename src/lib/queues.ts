import { Queue } from 'bullmq';
import { redis, REDIS_KEY_PREFIX } from './redis';

export const SYNC_SOURCE_QUEUE = 'sync-source';
export const CHECK_SOURCE_QUEUE = 'check-source';
export const NOTIFICATION_QUEUE = 'notifications';
export const CANONICALIZE_QUEUE = 'canonicalize';

export const syncSourceQueue = new Queue(SYNC_SOURCE_QUEUE, {
  connection: redis,
  prefix: REDIS_KEY_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const checkSourceQueue = new Queue(CHECK_SOURCE_QUEUE, {
  connection: redis,
  prefix: REDIS_KEY_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const notificationQueue = new Queue(NOTIFICATION_QUEUE, {
  connection: redis,
  prefix: REDIS_KEY_PREFIX,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const canonicalizeQueue = new Queue(CANONICALIZE_QUEUE, {
  connection: redis,
  prefix: REDIS_KEY_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

/**
 * Checks if a queue is healthy based on the number of waiting/active jobs.
 * This provides backpressure detection for the API.
 */
export async function isQueueHealthy(queue: Queue, threshold = 5000): Promise<boolean> {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
    const total = counts.waiting + counts.active + counts.delayed;
    return total < threshold;
  } catch (error) {
    console.error(`[Queue] Error checking health for ${queue.name}:`, error);
    return false; // Fail safe: assume unhealthy if check fails
  }
}
