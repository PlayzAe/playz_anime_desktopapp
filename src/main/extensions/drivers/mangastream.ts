import type { Chapter, ChapterPage, MediaDetail } from '../../../shared/types';
import type { MangaExtensionConfig, MangaExtensionSource } from '../types';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function score(a: string, b: string): number {
  const an = normalize(a);
  const bn = normalize(b);
  if (an === bn) return 1.0;
  if (an.includes(bn) || bn.includes(an)) return 0.8;
  return 0.0;
}

export class MangaStreamDriver implements MangaExtensionSource {
  readonly config: MangaExtensionConfig;

  constructor(config: MangaExtensionConfig) {
    this.config = config;
  }

  async ping(): Promise<boolean> {
    const res = await fetch(this.config.baseUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  }

  async find(media: MediaDetail, _adultAllowed: boolean): Promise<{ sourceId: string; title: string } | null> {
    const titles = [media.title.romaji, media.title.english, ...(media.synonyms ?? [])].filter(Boolean) as string[];
    for (const title of titles.slice(0, 3)) {
      try {
        const searchUrl = `${this.config.baseUrl}/?s=${encodeURIComponent(title)}`;
        const res = await fetch(searchUrl, {
          headers: { 'User-Agent': USER_AGENT, Referer: this.config.baseUrl },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const matches = [...html.matchAll(/<div\b[^>]*class=["'][^"']*(?:bsx|animepost)[^"']*["'][^>]*>[\s\S]*?<a\s+href=["']([^"']+)["']\s+title=["']([^"']+)["']/gis)]
          .map(m => ({ url: m[1], title: m[2].trim() }));

        for (const match of matches) {
          if (titles.some(t => score(t, match.title) >= 0.8)) {
            const path = match.url.replace(this.config.baseUrl, '').replace(/^\/+/, '');
            return { sourceId: path, title: match.title };
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async chapters(sourceId: string): Promise<Chapter[]> {
    const pageUrl = `${this.config.baseUrl}/${sourceId.replace(/^\/+/, '')}`;
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: this.config.baseUrl },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const chapterMatches = [...html.matchAll(/<li\b[^>]*data-num=["']([^"']+)["'][^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][\s\S]*?<span\s+class=["']chapternum["']>([^<]+)<\/span>/gis)]
      .map(m => {
        const number = m[1].trim();
        const url = m[2];
        const text = m[3].trim();
        const path = url.replace(this.config.baseUrl, '').replace(/^\/+/, '');
        return {
          id: `${this.config.id}:${path}`,
          provider: this.config.id as any,
          number,
          title: text || `Chapter ${number}`,
          volume: null,
          group: this.config.name,
          pages: null,
          publishedAt: null,
          externalUrl: null,
        };
      });

    if (chapterMatches.length) return chapterMatches;

    // Fallback: regular links
    const fallbackMatches = [...html.matchAll(/<div\b[^>]*class=["']eplister["'][\s\S]*?<a\s+href=["']([^"']+)["'][\s\S]*?<span\s+class=["']chapternum["']>([^<]+)<\/span>/gis)]
      .map(m => {
        const url = m[1];
        const text = m[2].trim();
        const numMatch = text.match(/([0-9.]+)/);
        const number = numMatch ? numMatch[1] : null;
        const path = url.replace(this.config.baseUrl, '').replace(/^\/+/, '');
        return {
          id: `${this.config.id}:${path}`,
          provider: this.config.id as any,
          number,
          title: text,
          volume: null,
          group: this.config.name,
          pages: null,
          publishedAt: null,
          externalUrl: null,
        };
      });

    return fallbackMatches;
  }

  async pages(sourceId: string): Promise<ChapterPage[]> {
    const chapterUrl = `${this.config.baseUrl}/${sourceId.replace(/^\/+/, '')}`;
    const res = await fetch(chapterUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: this.config.baseUrl },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Look for ts_reader.run({ ... })
    const tsMatch = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
    if (tsMatch) {
      try {
        const data = JSON.parse(tsMatch[1]);
        const images: string[] = data.sources?.[0]?.images ?? [];
        if (images.length) return images.map(url => ({ url }));
      } catch {
        // Fall back to DOM scrape
      }
    }

    const imgMatches = [...html.matchAll(/<img\b[^>]+(?:data-lazy-src|data-src|src)=["']([^"']+)["'][^>]*class=["'][^"']*ts-main-image[^"']*["']/gi)]
      .map(m => m[1].trim());

    return imgMatches.map(url => ({ url }));
  }
}
