import 'dotenv/config';
import { Worker } from 'bullmq';
import { redis, disconnectRedis, REDIS_KEY_PREFIX, setWorkerHeartbeat } from '@/lib/redis';
import { SYNC_SOURCE_QUEUE, CHECK_SOURCE_QUEUE, NOTIFICATION_QUEUE, CANONICALIZE_QUEUE } from '@/lib/queues';
import { processSyncSource } from './processors/sync-source.processor';
import { processCheckSource } from './processors/check-source.processor';
import { processNotification } from './processors/notification.processor';
import { processCanonicalize } from './processors/canonicalize.processor';
import { runMasterScheduler } from './schedulers/master.scheduler';

// Log connection status for workers
redis.on('connect', () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const maskedUrl = redisUrl.replace(/\/\/.*@/, '//****:****@');
  console.log(`[Workers] Connected to Redis at ${maskedUrl}`);
});

console.log('[Workers] Starting...');

// Canonicalization Worker
const canonicalizeWorker = new Worker(
  CANONICALIZE_QUEUE,
  processCanonicalize,
  { 
    connection: redis,
    prefix: REDIS_KEY_PREFIX,
    concurrency: 5,
  }
);

// Sync Source Worker (Handles chapter updates)
const syncSourceWorker = new Worker(
  SYNC_SOURCE_QUEUE,
  processSyncSource,
  { 
    connection: redis,
    prefix: REDIS_KEY_PREFIX,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

// Check Source Worker (Handles MangaDex search/candidate discovery)
const checkSourceWorker = new Worker(
  CHECK_SOURCE_QUEUE,
  processCheckSource,
  { 
    connection: redis,
    prefix: REDIS_KEY_PREFIX,
    concurrency: 5,
    limiter: {
      max: 5,
      duration: 1000,
    },
  }
);

// Notification Worker
const notificationWorker = new Worker(
  NOTIFICATION_QUEUE,
  processNotification,
  { 
    connection: redis,
    prefix: REDIS_KEY_PREFIX,
    concurrency: 10,
  }
);

// Heartbeat interval - tells the API that workers are online
const HEARTBEAT_INTERVAL = 5 * 1000; // 5 seconds
let heartbeatInterval: NodeJS.Timeout | null = null;

async function startHeartbeat() {
  // Send initial heartbeat
  await setWorkerHeartbeat();
  console.log('[Workers] Initial heartbeat sent');
  
  // Send periodic heartbeats
  heartbeatInterval = setInterval(async () => {
    try {
      await setWorkerHeartbeat();
      console.log('[Workers] Heartbeat sent');
    } catch (error) {
      console.error('[Workers] Failed to send heartbeat:', error);
    }
  }, HEARTBEAT_INTERVAL);
}

// Scheduler interval
const SCHEDULER_INTERVAL = 5 * 60 * 1000; // 5 minutes
let schedulerInterval: NodeJS.Timeout | null = null;

async function startScheduler() {
  // Run immediately on start
  try {
    await runMasterScheduler();
  } catch (error) {
    console.error('[Scheduler] Initial run failed:', error);
  }
  
  schedulerInterval = setInterval(async () => {
    try {
      await runMasterScheduler();
    } catch (error) {
      console.error('[Scheduler] Error in master scheduler:', error);
    }
  }, SCHEDULER_INTERVAL);
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[Workers] Received ${signal}, shutting down gracefully...`);
  
  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  // Stop scheduler
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  // Close workers (waits for current jobs to finish)
  await Promise.all([
    canonicalizeWorker.close(),
    syncSourceWorker.close(),
    checkSourceWorker.close(),
    notificationWorker.close(),
  ]);

  // Disconnect Redis
  await disconnectRedis();
  
  console.log('[Workers] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Worker event handlers with detailed logging
syncSourceWorker.on('completed', (job) => {
  console.log(`[SyncSource] Job ${job.id} completed`);
});

syncSourceWorker.on('failed', (job, err) => {
  console.error(`[SyncSource] Job ${job?.id} failed:`, err.message);
});

syncSourceWorker.on('active', (job) => {
  console.log(`[SyncSource] Job ${job.id} started processing`);
});

checkSourceWorker.on('completed', (job) => {
  console.log(`[CheckSource] Job ${job.id} completed`);
});

checkSourceWorker.on('failed', (job, err) => {
  console.error(`[CheckSource] Job ${job?.id} failed:`, err.message);
});

checkSourceWorker.on('active', (job) => {
  console.log(`[CheckSource] Job ${job.id} started processing`);
});

notificationWorker.on('completed', (job) => {
  console.log(`[Notification] Job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  console.error(`[Notification] Job ${job?.id} failed:`, err.message);
});

canonicalizeWorker.on('completed', (job) => {
  console.log(`[Canonicalize] Job ${job.id} completed`);
});

canonicalizeWorker.on('failed', (job, err) => {
  console.error(`[Canonicalize] Job ${job?.id} failed:`, err.message);
});

canonicalizeWorker.on('active', (job) => {
  console.log(`[Canonicalize] Job ${job.id} started processing`);
});

// Start heartbeat and scheduler
startHeartbeat().catch(console.error);
startScheduler().catch(console.error);

console.log('[Workers] Started');
console.log('[Workers] Active and listening for jobs');
