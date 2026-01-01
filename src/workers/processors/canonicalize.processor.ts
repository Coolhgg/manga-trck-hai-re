import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface CanonicalizeJobData {
  title: string;
  source_name: string;
  source_id: string;
  source_url: string;
  mangadex_id?: string;
  alternative_titles?: string[];
  description?: string;
  cover_url?: string;
  type: string;
  status?: string;
  genres?: string[];
  content_rating?: string;
  confidence?: number;
}

export async function processCanonicalize(job: Job<CanonicalizeJobData>) {
  const { 
    title, 
    source_name, 
    source_id, 
    source_url, 
    mangadex_id, 
    alternative_titles = [], 
    description, 
    cover_url,
    type,
    status,
    genres = [],
    content_rating,
    confidence
  } = job.data;

  console.log(`[Canonicalize] Job ${job.id} started processing: ${source_name}:${source_id} - "${title}"`);

  const result = await prisma.$transaction(async (tx) => {
    let series = null;
    let created = false;

    // 1. Match by MangaDex ID
    if (mangadex_id) {
      series = await tx.series.findUnique({
        where: { mangadex_id },
      });
      if (series) {
        console.log(`[Canonicalize] Matched by mangadex_id: ${series.title} (ID: ${series.id})`);
      }
    }

    // 2. Match by existing source ID
    if (!series) {
      const existingSource = await tx.seriesSource.findUnique({
        where: {
          source_name_source_id: {
            source_name,
            source_id,
          },
        },
        include: { series: true },
      });
      if (existingSource) {
        series = existingSource.series;
        console.log(`[Canonicalize] Matched by source link: ${series.title} (ID: ${series.id})`);
      }
    }

    // 3. Match by exact title
    if (!series) {
      series = await tx.series.findFirst({
        where: {
          title: {
            equals: title,
            mode: 'insensitive',
          },
        },
      });
      if (series) {
        console.log(`[Canonicalize] Matched by title: ${series.title} (ID: ${series.id})`);
      }
    }

      // Merge alternative titles
      const currentAltTitles = (series?.alternative_titles as string[]) || [];
      const mergedAltTitles = Array.from(new Set([...currentAltTitles, ...alternative_titles, title]));

      if (series) {
          // Determine if we should update the cover
          // Update cover if: incoming has cover AND (current is empty OR source is mangadex)
          const shouldUpdateCover = cover_url && (!series.cover_url || source_name === 'mangadex');
          const newCoverUrl = shouldUpdateCover ? cover_url : series.cover_url;
          
          // Update existing series with new metadata if missing
          series = await tx.series.update({
            where: { id: series.id },
            data: {
              mangadex_id: series.mangadex_id || mangadex_id,
              description: series.description || description,
              cover_url: newCoverUrl,
              alternative_titles: mergedAltTitles,
              status: series.status || status,
              genres: series.genres.length > 0 ? series.genres : genres,
              content_rating: content_rating || series.content_rating,
            },
          });

      console.log(`[Canonicalize] Updated existing series: ${series.title}`);
    } else {
      console.log(`[Canonicalize] Creating new canonical series: "${title}"`);
      // Create new series
      series = await tx.series.create({
        data: {
          title,
          mangadex_id,
          alternative_titles: mergedAltTitles,
          description,
          cover_url,
          type,
          status,
          genres,
          content_rating,
        },
      });
      created = true;
      console.log(`[Canonicalize] Created new series: ${series.title} (ID: ${series.id})`);
    }

      // Upsert the source link with cover metadata
      await tx.seriesSource.upsert({
        where: {
          source_name_source_id: {
            source_name,
            source_id,
          },
        },
        update: {
          series_id: series.id,
          source_url,
          source_title: title,
          match_confidence: confidence,
          cover_url: cover_url || undefined,
          cover_updated_at: cover_url ? new Date() : undefined,
        },
        create: {
          series_id: series.id,
          source_name,
          source_id,
          source_url,
          source_title: title,
          match_confidence: confidence,
          sync_priority: 'COLD',
          cover_url: cover_url || null,
          cover_updated_at: cover_url ? new Date() : null,
        },
      });

    return { series, created };
  });

  console.log(`[Canonicalize] Job ${job.id} completed for "${result.series.title}" (created: ${result.created})`);

  // Emit series.available event via Supabase Realtime
  console.log(`[Canonicalize] Emitting series.available event for "${result.series.title}"`);
  try {
    await supabaseAdmin
      .channel('public:series')
      .send({
        type: 'broadcast',
        event: 'series.available',
        payload: {
          series_id: result.series.id,
          mangadex_id,
          title: result.series.title,
          created: result.created
        }
      });
    console.log(`[Canonicalize] series.available event emitted successfully`);
  } catch (err) {
    console.error(`[Canonicalize] Failed to emit series.available event:`, err);
  }

  return { series_id: result.series.id, created: result.created };
}
