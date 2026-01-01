import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { scrapers, ScraperError, validateSourceUrl } from '@/lib/scrapers';
import { notificationQueue } from '@/lib/queues';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const MAX_CONSECUTIVE_FAILURES = 5;

const CheckSourceDataSchema = z.object({
  seriesSourceId: z.string().uuid(),
});

export interface CheckSourceData {
  seriesSourceId: string;
}

export async function processSyncSource(job: Job<CheckSourceData>) {
  // Validate job payload
  const parseResult = CheckSourceDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    throw new Error(`Invalid job payload: ${parseResult.error.message}`);
  }

  const { seriesSourceId } = parseResult.data;

  const source = await prisma.seriesSource.findUnique({
    where: { id: seriesSourceId },
    include: { series: true }
  });

  if (!source) {
    console.warn(`[Worker] Source ${seriesSourceId} not found, skipping`);
    return; // Don't retry, source was deleted
  }

  // Circuit breaker: skip if too many consecutive failures
  if (source.failure_count >= MAX_CONSECUTIVE_FAILURES) {
    console.warn(`[Worker] Source ${seriesSourceId} circuit breaker open (${source.failure_count} failures)`);
    
    // Demote to COLD and extend next check
    await prisma.seriesSource.update({
      where: { id: source.id },
      data: {
        sync_priority: 'COLD',
        next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24hr
      }
    });
    return;
  }

  // Validate source URL
  if (!validateSourceUrl(source.source_url)) {
    console.error(`[Worker] Invalid source URL for ${seriesSourceId}`);
    await prisma.seriesSource.update({
      where: { id: source.id },
      data: {
        failure_count: { increment: 1 },
        last_checked_at: new Date(),
      }
    });
    return; // Don't retry, URL is invalid
  }

  const scraper = scrapers[source.source_name.toLowerCase()];
  if (!scraper) {
    console.error(`[Worker] No scraper for source ${source.source_name}`);
    return; // Don't retry, no scraper available
  }

  try {
    const scrapedData = await scraper.scrapeSeries(source.source_id);
    
    // Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Get existing chapters within transaction to prevent race conditions
      const existingChapters = await tx.chapter.findMany({
        where: { series_source_id: source.id },
        select: { chapter_number: true }
      });

      const existingNumbers = new Set(
        existingChapters.map(c => c.chapter_number.toString())
      );
      
      const newChaptersData: Prisma.ChapterCreateManyInput[] = [];

      for (const chapter of scrapedData.chapters) {
        const chapterKey = chapter.chapterNumber.toString();
        if (!existingNumbers.has(chapterKey)) {
          newChaptersData.push({
            series_id: source.series_id,
            series_source_id: source.id,
            chapter_number: new Prisma.Decimal(chapter.chapterNumber),
            chapter_title: chapter.chapterTitle || null,
            chapter_url: chapter.chapterUrl,
            published_at: chapter.publishedAt || null,
          });
        }
      }

      let insertedCount = 0;
      if (newChaptersData.length > 0) {
        // Use skipDuplicates for idempotency (handles race conditions)
        const inserted = await tx.chapter.createMany({
          data: newChaptersData,
          skipDuplicates: true,
        });
        insertedCount = inserted.count;
      }

      // Update source status atomically
      await tx.seriesSource.update({
        where: { id: source.id },
        data: {
          last_checked_at: new Date(),
          last_success_at: new Date(),
          source_chapter_count: { increment: insertedCount },
          failure_count: 0, // Reset on success
        }
      });

      return insertedCount;
    });

    if (result > 0) {
      // Queue notification with deduplication key
      const notificationJobId = `notify-${source.series_id}-${Date.now()}`;
      await notificationQueue.add(
        notificationJobId,
        {
          seriesId: source.series_id,
          sourceId: source.id,
          newChapterCount: result,
        },
        {
          jobId: notificationJobId, // Prevents duplicate jobs
        }
      );

      console.log(`[Worker] Found ${result} new chapters for ${source.series.title} (${source.source_name})`);
    } else {
      console.log(`[Worker] No new chapters for ${source.series.title} (${source.source_name})`);
    }

  } catch (error) {
    const isRetryable = error instanceof ScraperError ? error.isRetryable : true;
    
    console.error(`[Worker] Error checking source ${source.id}:`, error);
    
    await prisma.seriesSource.update({
      where: { id: source.id },
      data: {
        last_checked_at: new Date(),
        failure_count: { increment: 1 },
      }
    });

    if (isRetryable) {
      throw error; // Let BullMQ retry
    }
    // Non-retryable errors are logged but don't cause retry
  }
}
