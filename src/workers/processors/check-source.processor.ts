import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { canonicalizeQueue } from '@/lib/queues';
import { getMangaDexHeaders, MANGADEX_API_BASE } from '@/lib/config/mangadex';
import { SearchIntent } from '@/lib/search-intent';

interface CheckSourceJobData {
  query?: string;
  series_id?: string;
  intent?: SearchIntent;
  trigger?: 'user_search' | 'system_sync';
}

interface LanguageAwareTitle {
  title: string;
  lang: string;
}

interface MangaDexCandidate {
  mangadex_id: string;
  title: string;
  title_lang: string;
  alternative_titles: LanguageAwareTitle[];
  original_language: string;
  description: string;
  status: string;
  type: string;
  genres: string[];
  content_rating?: string;
  cover_url?: string;
  follows?: number;
  rating?: number;
  score?: number;
  confidence?: number;
}

/**
 * Processor to search MangaDex for potential canonical matches.
 */
export async function processCheckSource(job: Job<CheckSourceJobData>) {
  const { query, series_id, trigger } = job.data;
  
  console.log(`[CheckSource] Job ${job.id} started processing`);
  
  let searchTerm = query;

  // Resolve search term from series_id if query is missing
  if (!searchTerm && series_id) {
    const series = await prisma.series.findUnique({
      where: { id: series_id },
      select: { title: true },
    });
    searchTerm = series?.title;
  }

  if (!searchTerm) {
    console.error(`[CheckSource] Job ${job.id} failed: No search term provided`);
    throw new Error('No search term provided or found for series_id');
  }

  console.log(`[CheckSource] Job ${job.id} searching for "${searchTerm}" (Trigger: ${trigger || 'unknown'}, Intent: ${job.data.intent || 'unknown'})`);

  const PAGE_LIMIT = 32;
  // Adjust pagination depth based on intent
  const MAX_PAGES = 3; 
  
  const candidates: MangaDexCandidate[] = [];
  const normalizedQuery = normalize(searchTerm);

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    const url = new URL(`${MANGADEX_API_BASE}/manga`);
    
    url.searchParams.set('title', searchTerm);
    url.searchParams.set('limit', PAGE_LIMIT.toString());
    url.searchParams.set('offset', offset.toString());
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('includes[]', 'statistics'); // Fetch follows/rating
    
    url.searchParams.append('contentRating[]', 'safe');
    url.searchParams.append('contentRating[]', 'suggestive');
    url.searchParams.append('contentRating[]', 'erotica');
    url.searchParams.append('contentRating[]', 'pornographic');

    try {
      const response = await fetch(url.toString(), {
        headers: getMangaDexHeaders(),
      });

      if (response.status === 429) {
        console.warn('[CheckSource] MangaDex Rate Limit exceeded, stopping search');
        break;
      }

      if (!response.ok) {
        console.error(`[CheckSource] MangaDex API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const results = data.data || [];
      const statisticsMap = data.statistics || {};

      if (results.length === 0) break;

      for (const manga of results) {
        const attrs = manga.attributes;
        
        // Extract all titles with their language codes
        const titleMap = attrs.title || {};
        const titles = Object.entries(titleMap).map(([lang, title]) => ({ title: title as string, lang }));
        const altTitles = (attrs.altTitles || []).flatMap((t: any) => 
          Object.entries(t).map(([lang, title]) => ({ title: title as string, lang }))
        );
        
        const allTitles = [...titles, ...altTitles].filter(t => !!t.title);
        const primaryTitleObj = titles[0] || altTitles[0] || { title: 'Unknown Title', lang: 'unknown' };
        
        // 1:1 Parity Rule: No local filtering. Trust MangaDex results.

        const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
          
          // Extract cover from cover_art relationship - try multiple approaches
          const coverRels = manga.relationships.filter((r: any) => r.type === 'cover_art');
          let coverFileName: string | undefined;
          
          // Try to find a cover_art with fileName in attributes
          for (const rel of coverRels) {
            if (rel.attributes?.fileName) {
              coverFileName = rel.attributes.fileName;
              break;
            }
          }
          
          // Build cover URL only if we have a valid fileName (not a placeholder/generic image)
          const isValidCoverFile = coverFileName && 
            !coverFileName.includes('avatar') && 
            !coverFileName.includes('logo') &&
            !coverFileName.includes('placeholder');
            
          const coverUrl = isValidCoverFile 
            ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}`
            : undefined;

        const genres = attrs.tags
          .filter((tag: any) => tag.attributes.group === 'genre')
          .map((tag: any) => tag.attributes.name.en);

        const stats = statisticsMap[manga.id] || manga.statistics || attrs.statistics;
        const follows = stats?.follows;
        const rating = stats?.rating?.average;

        candidates.push({
          mangadex_id: manga.id,
          title: primaryTitleObj.title,
          title_lang: primaryTitleObj.lang,
          alternative_titles: allTitles,
          original_language: attrs.originalLanguage,
          description,
          status: attrs.status,
          type: attrs.publicationDemographic || 'unknown',
          genres,
          content_rating: attrs.contentRating,
          cover_url: coverUrl,
          follows,
          rating,
        });
      }

      if (results.length < PAGE_LIMIT) break;

    } catch (error) {
      console.error(`[CheckSource] Network error fetching from MangaDex:`, error);
      break;
    }
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map(c => [c.mangadex_id, c])).values()
  );

  // 1:1 Parity Rule: Trust MangaDex ordering.
  const rankedCandidates = uniqueCandidates.map((c, index) => ({
    ...c,
    confidence: 100, // Trusted source
    score: uniqueCandidates.length - index, // Preserves MangaDex order
  }));

  for (const candidate of rankedCandidates) {
    const jobId = `canon_mangadex_${candidate.mangadex_id}`;
    
    console.log(`[CheckSource] Enqueuing candidate "${candidate.title}" with content_rating: ${candidate.content_rating}`);

    await canonicalizeQueue.add('canonicalize', {
      title: candidate.title,
      source_name: 'mangadex',
      source_id: candidate.mangadex_id,
      source_url: `https://mangadex.org/title/${candidate.mangadex_id}`,
      mangadex_id: candidate.mangadex_id,
      alternative_titles: candidate.alternative_titles.map(t => t.title),
      description: candidate.description,
      cover_url: candidate.cover_url,
      type: candidate.type,
      status: candidate.status,
      genres: candidate.genres,
      content_rating: candidate.content_rating,
      confidence: candidate.confidence,
    }, {
      jobId,
      priority: trigger === 'user_search' ? 1 : 10,
      removeOnComplete: true,
    });
  }

  console.log(`[CheckSource] Job ${job.id} completed: ${rankedCandidates.length} candidates enqueued`);

  return { found: rankedCandidates.length };
}
