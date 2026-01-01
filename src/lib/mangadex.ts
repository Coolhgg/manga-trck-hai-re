import { getMangaDexHeaders, MANGADEX_API_BASE } from './config/mangadex';

export interface MangaDexCandidate {
  mangadex_id: string;
  title: string;
  alternative_titles: string[];
  description: string;
  status: string;
  type: string;
  genres: string[];
  content_rating?: string;
  cover_url?: string;
  source: 'mangadex';
}

export async function searchMangaDex(searchTerm: string): Promise<MangaDexCandidate[]> {
  const url = new URL(`${MANGADEX_API_BASE}/manga`);
  url.searchParams.set('title', searchTerm);
    url.searchParams.set('limit', '32');

  url.searchParams.append('includes[]', 'cover_art');
  url.searchParams.append('contentRating[]', 'safe');
  url.searchParams.append('contentRating[]', 'suggestive');
  url.searchParams.append('contentRating[]', 'erotica');
  url.searchParams.append('contentRating[]', 'pornographic');

  const response = await fetch(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (response.status === 429) {
    throw new Error('MangaDex Rate Limit exceeded');
  }
  if (response.status === 403 || response.headers.get('server')?.includes('cloudflare')) {
    throw new Error('MangaDex blocked by Cloudflare/Forbidden');
  }
  if (!response.ok) {
    throw new Error(`MangaDex API error: ${response.status}`);
  }

  const data = await response.json();
  const candidates: MangaDexCandidate[] = [];

  for (const manga of data.data) {
    const attrs = manga.attributes;
    const title = attrs.title.en || Object.values(attrs.title)[0] as string;
    const altTitles = attrs.altTitles.map((t: any) => Object.values(t)[0] as string);
    const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
    
    const coverRel = manga.relationships.find((r: any) => r.type === 'cover_art' && r.attributes?.fileName);
    const coverFileName = coverRel?.attributes?.fileName;
    const coverUrl = coverFileName 
      ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}`
      : undefined;

    const genres = attrs.tags
      .filter((tag: any) => tag.attributes.group === 'genre')
      .map((tag: any) => tag.attributes.name.en);

    candidates.push({
      mangadex_id: manga.id,
      title,
      alternative_titles: Array.from(new Set(altTitles)),
      description,
      status: attrs.status,
      type: attrs.publicationDemographic || 'unknown',
      genres,
      content_rating: attrs.contentRating,
      cover_url: coverUrl,
      source: 'mangadex',
    });
  }

  return candidates;
}
