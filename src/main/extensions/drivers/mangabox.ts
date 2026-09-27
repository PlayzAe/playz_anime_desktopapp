import type { Chapter, ChapterPage, MediaDetail } from '../../../src/shared/types';
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

export class MangaBoxDriver implements MangaExtensionSource {
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
        const querySlug = normalize(title).replace(/\s+/g, '_');
        const searchUrl = `${this.config.baseUrl}/search/story/${encodeURIComponent(querySlug)}`;
        const res = await fetch(searchUrl, {
          headers: { 'User-Agent': USER_AGENT, Referer: this.config.baseUrl },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const matches = [...html.matchAll(/<h3\b[^>]*class=["'][^"']*item-title[^"']*["'][^>]*>\s*<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)]
          .map(m => ({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() }));

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

    const chapterMatches = [...html.matchAll(/<a\b[^>]*class=["']chapter-name[^"']*["']\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)]
      .map(m => {
        const url = m[1];
        const text = m[2].replace(/<[^>]+>/g, '').trim();
        const numMatch = text.match(/chapter\s*([0-9.]+)/i);
        const number = numMatch ? numMatch[1] : null;
        const path = url.replace(this.config.baseUrl, '').replace(/^\/+/, '');
        return {
          id: `${this.config.id}:${path}`,
          provider: this.config.id as any,
          number,
          title: text || (number ? `Chapter ${number}` : null),
          volume: null,
          group: this.config.name,
          pages: null,
          publishedAt: null,
          externalUrl: null,
        };
      });

    return chapterMatches;
  }

  async pages(sourceId: string): Promise<ChapterPage[]> {
    const chapterUrl = `${this.config.baseUrl}/${sourceId.replace(/^\/+/, '')}`;
    const res = await fetch(chapterUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: this.config.baseUrl },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const imgMatches = [...html.matchAll(/<div\b[^>]*class=["']container-chapter-reader["'][\s\S]*?<img\b[^>]+src=["']([^"']+)["']/gis)]
      .map(m => m[1].trim());

    if (imgMatches.length) return imgMatches.map(url => ({ url }));

    const anyImgs = [...html.matchAll(/<img\b[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/gi)]
      .map(m => m[1].trim())
      .filter(u => u.includes('chapter') || u.includes('manga') || u.includes('image'));

    return anyImgs.map(url => ({ url }));
  }
}
