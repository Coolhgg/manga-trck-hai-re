import { prisma } from '@/lib/prisma';
import { syncSourceQueue } from '@/lib/queues';

export const SYNC_INTERVALS = {
  HOT: 15 * 60 * 1000,      // 15 mins
  WARM: 2 * 60 * 60 * 1000,  // 2 hours
  COLD: 24 * 60 * 60 * 1000, // 24 hours
} as const;

type SyncPriority = keyof typeof SYNC_INTERVALS;

export async function runMasterScheduler() {
  console.log('[Scheduler] Running master scheduler...');

  const now = new Date();

  // Find sources due for check
  const sourcesToUpdate = await prisma.seriesSource.findMany({
    where: {
      OR: [
        { next_check_at: { lte: now } },
        { next_check_at: null }
      ]
    },
    select: {
      id: true,
      sync_priority: true,
    },
    take: 50, // Batch limit
  });

  if (sourcesToUpdate.length === 0) {
    console.log('[Scheduler] No sources due for sync.');
    return;
  }

  console.log(`[Scheduler] Queuing ${sourcesToUpdate.length} sources for sync.`);

  // Group sources by priority for batch updates
  const updatesByPriority: Record<string, string[]> = {
    HOT: [],
    WARM: [],
    COLD: [],
  };

    const jobs = sourcesToUpdate.map(source => {
      const priority = source.sync_priority as SyncPriority;
      if (updatesByPriority[priority]) {
        updatesByPriority[priority].push(source.id);
      } else {
        updatesByPriority.COLD.push(source.id); // Default to COLD
      }

      return {
        name: `sync-${source.id}`,
        data: { seriesSourceId: source.id },
        opts: {
          jobId: `sync-${source.id}-${now.getTime()}`,
          priority: priority === 'HOT' ? 1 : priority === 'WARM' ? 2 : 3,
        }
      };
    });

  // Bulk add jobs to queue
  await syncSourceQueue.addBulk(jobs);

  // Batch update next_check_at by priority (eliminates N+1)
  const updatePromises = Object.entries(updatesByPriority)
    .filter(([_, ids]) => ids.length > 0)
    .map(([priority, ids]) => {
      const interval = SYNC_INTERVALS[priority as SyncPriority] || SYNC_INTERVALS.COLD;
      const nextCheck = new Date(now.getTime() + interval);

      return prisma.seriesSource.updateMany({
        where: { id: { in: ids } },
        data: { next_check_at: nextCheck }
      });
    });

  await Promise.all(updatePromises);

  console.log(`[Scheduler] Queued ${jobs.length} jobs, updated next_check_at`);
}
