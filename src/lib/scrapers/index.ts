export interface ScrapedChapter {
  chapterNumber: number;
  chapterTitle?: string;
  chapterUrl: string;
  publishedAt?: Date;
}

export interface ScrapedSeries {
  sourceId: string;
  title: string;
  chapters: ScrapedChapter[];
}

export interface Scraper {
  scrapeSeries(sourceId: string): Promise<ScrapedSeries>;
}

// Allowed hostnames to prevent SSRF
const ALLOWED_HOSTS = new Set([
  'mangapark.io',
  'www.mangapark.io',
  'mangadex.org',
  'api.mangadex.org',
]);

export function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export class ScraperError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly isRetryable: boolean = true
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

export class MangaParkScraper implements Scraper {
  private readonly TIMEOUT_MS = 30000;

  async scrapeSeries(sourceId: string): Promise<ScrapedSeries> {
    console.log(`[MangaPark] Scraping sourceId: ${sourceId}`);
    
    try {
      // Simulate network delay with timeout
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, 1000)),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.TIMEOUT_MS)
        ),
      ]);

      // Mock response - in production, this would be actual scraping
      return {
        sourceId,
        title: `MangaPark - ${sourceId}`,
        chapters: [
          {
            chapterNumber: 1,
            chapterTitle: "The Beginning",
            chapterUrl: `https://mangapark.io/title/${encodeURIComponent(sourceId)}/c1`,
            publishedAt: new Date(Date.now() - 86400000 * 10),
          },
          {
            chapterNumber: 2,
            chapterTitle: "The Journey",
            chapterUrl: `https://mangapark.io/title/${encodeURIComponent(sourceId)}/c2`,
            publishedAt: new Date(Date.now() - 86400000 * 5),
          },
          {
            chapterNumber: 3,
            chapterTitle: "New Discovery",
            chapterUrl: `https://mangapark.io/title/${encodeURIComponent(sourceId)}/c3`,
            publishedAt: new Date(),
          }
        ]
      };
    } catch (error) {
      throw new ScraperError(
        `MangaPark scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'mangapark',
        true
      );
    }
  }
}

export class MangaDexScraper implements Scraper {
  private readonly TIMEOUT_MS = 30000;

  async scrapeSeries(sourceId: string): Promise<ScrapedSeries> {
    console.log(`[MangaDex] Fetching sourceId: ${sourceId}`);
    
    try {
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, 800)),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.TIMEOUT_MS)
        ),
      ]);

      return {
        sourceId,
        title: `MangaDex - ${sourceId}`,
        chapters: [
          {
            chapterNumber: 1,
            chapterTitle: "Chapter 1",
            chapterUrl: `https://mangadex.org/chapter/${encodeURIComponent(sourceId)}-c1`,
            publishedAt: new Date(Date.now() - 86400000 * 20),
          },
          {
            chapterNumber: 1.5,
            chapterTitle: "Extra",
            chapterUrl: `https://mangadex.org/chapter/${encodeURIComponent(sourceId)}-c1.5`,
            publishedAt: new Date(Date.now() - 86400000 * 15),
          }
        ]
      };
    } catch (error) {
      throw new ScraperError(
        `MangaDex fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'mangadex',
        true
      );
    }
  }
}

export const scrapers: Record<string, Scraper> = {
  'mangapark': new MangaParkScraper(),
  'mangadex': new MangaDexScraper(),
};
