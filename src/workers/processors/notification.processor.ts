import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const NotificationJobDataSchema = z.object({
  seriesId: z.string().uuid(),
  sourceId: z.string().uuid(),
  newChapterCount: z.number().int().positive(),
});

export interface NotificationJobData {
  seriesId: string;
  sourceId: string;
  newChapterCount: number;
}

export async function processNotification(job: Job<NotificationJobData>) {
  // Validate payload
  const parseResult = NotificationJobDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    console.error(`[Notification] Invalid payload: ${parseResult.error.message}`);
    return; // Don't retry invalid payloads
  }

  const { seriesId, sourceId, newChapterCount } = parseResult.data;

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { title: true }
  });

  if (!series) {
    console.warn(`[Notification] Series ${seriesId} not found, skipping`);
    return;
  }

  // Find subscribers
  const subscribers = await prisma.libraryEntry.findMany({
    where: {
      series_id: seriesId,
      notify_new_chapters: true,
    },
    select: {
      user_id: true,
    }
  });

  if (subscribers.length === 0) {
    console.log(`[Notification] No subscribers for ${series.title}`);
    return;
  }

  // Check for recent duplicate notifications (idempotency window: 5 minutes)
  const idempotencyWindow = new Date(Date.now() - 5 * 60 * 1000);
  
  const existingNotifications = await prisma.notification.findMany({
    where: {
      series_id: seriesId,
      type: 'NEW_CHAPTER',
      created_at: { gte: idempotencyWindow },
    },
    select: { user_id: true }
  });

  const alreadyNotifiedUsers = new Set(existingNotifications.map(n => n.user_id));
  
  const notificationsToCreate = subscribers
    .filter(sub => !alreadyNotifiedUsers.has(sub.user_id))
    .map(sub => ({
      user_id: sub.user_id,
      type: 'NEW_CHAPTER',
      title: 'New Chapter Available',
      message: `${newChapterCount} new chapter${newChapterCount > 1 ? 's' : ''} for "${series.title}"!`,
      series_id: seriesId,
      metadata: {
        source_id: sourceId,
        chapter_count: newChapterCount,
        job_id: job.id,
      }
    }));

  if (notificationsToCreate.length === 0) {
    console.log(`[Notification] All subscribers already notified for ${series.title}`);
    return;
  }

  await prisma.notification.createMany({
    data: notificationsToCreate,
  });

  console.log(`[Notification] Created ${notificationsToCreate.length} notifications for ${series.title}`);
}
