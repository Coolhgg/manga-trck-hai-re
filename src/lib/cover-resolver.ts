import { prisma } from '@/lib/prisma';

export const SOURCE_PRIORITY: Record<string, number> = {
  mangadex: 10,
  mangapark: 5,
};

export interface CoverResult {
  cover_url: string;
  source_name: string;
  cover_width?: number | null;
  cover_height?: number | null;
}

export async function getBestCover(seriesId: string): Promise<CoverResult | null> {
  const sources = await prisma.seriesSource.findMany({
    where: { series_id: seriesId },
    select: {
      source_name: true,
      cover_url: true,
      cover_width: true,
      cover_height: true,
      cover_updated_at: true,
      is_primary_cover: true,
    },
  });

  return selectBestCover(sources);
}

export function selectBestCover(
  sources: Array<{
    source_name: string;
    cover_url: string | null;
    cover_width?: number | null;
    cover_height?: number | null;
    cover_updated_at?: Date | null;
    is_primary_cover?: boolean;
  }>
): CoverResult | null {
  const withCovers = sources.filter((s) => !!s.cover_url);

  if (withCovers.length === 0) return null;

  const ranked = withCovers.sort((a, b) => {
    if (a.is_primary_cover !== b.is_primary_cover) {
      return a.is_primary_cover ? -1 : 1;
    }

    const aPrio = SOURCE_PRIORITY[a.source_name] ?? 1;
    const bPrio = SOURCE_PRIORITY[b.source_name] ?? 1;
    if (aPrio !== bPrio) return bPrio - aPrio;

    const aRes = (a.cover_width ?? 0) * (a.cover_height ?? 0);
    const bRes = (b.cover_width ?? 0) * (b.cover_height ?? 0);
    if (aRes !== bRes) return bRes - aRes;

    const aTime = a.cover_updated_at?.getTime() ?? 0;
    const bTime = b.cover_updated_at?.getTime() ?? 0;
    return bTime - aTime;
  });

  const best = ranked[0];
  return {
    cover_url: best.cover_url!,
    source_name: best.source_name,
    cover_width: best.cover_width,
    cover_height: best.cover_height,
  };
}

export async function getBestCoversBatch(
  seriesIds: string[]
): Promise<Map<string, CoverResult | null>> {
  if (seriesIds.length === 0) return new Map();

  const sources = await prisma.seriesSource.findMany({
    where: { series_id: { in: seriesIds } },
    select: {
      series_id: true,
      source_name: true,
      cover_url: true,
      cover_width: true,
      cover_height: true,
      cover_updated_at: true,
      is_primary_cover: true,
    },
  });

  const grouped = new Map<string, typeof sources>();
  for (const source of sources) {
    const existing = grouped.get(source.series_id) ?? [];
    existing.push(source);
    grouped.set(source.series_id, existing);
  }

  const result = new Map<string, CoverResult | null>();
  for (const seriesId of seriesIds) {
    const seriesSources = grouped.get(seriesId) ?? [];
    result.set(seriesId, selectBestCover(seriesSources));
  }

  return result;
}
