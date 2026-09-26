import type { Chapter, ChapterPage } from '../../shared/types';
import { getText, retry } from '../http';
import { registerRefererHosts } from '../network';
import { decodeEntities } from './anikoto';

/*
 * WeebCentral: a large manga, manhwa and manhua catalogue (the successor to
 * MangaSee). Its pages are server-rendered fragments, so three small requests
 * cover search, the full chapter list and a chapter's images.
 */

const BASE = 'https://weebcentral.com';
export const WEEBCENTRAL_REFERER = `${BASE}/`;

export interface CentralHit {
  id: string;
  title: string;
  kind: string | null;
  year: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]/g, '');
const READABLE_KINDS = ['manga', 'manhwa', 'manhua', 'oel'];

/**
 * Site searches match typed text literally. AniList titles often carry typographic
 * quotes and dashes ("I’m the Max-Level Newbie") that nobody types, so they find nothing.
 */
export function plainQuery(title: string): string {
  return title
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function search(query: string): Promise<CentralHit[]> {
  const url = `${BASE}/search/data?text=${encodeURIComponent(plainQuery(query))}&sort=Best%20Match&order=Descending&official=Any&display_mode=Minimal%20Display&limit=16&offset=0`;
  const html = await retry(() => getText(url, { timeoutMs: 15000, headers: { 'HX-Request': 'true', Referer: WEEBCENTRAL_REFERER } }));
  const hits: CentralHit[] = [];
  for (const article of html.split('<article').slice(1)) {
    const link = /href="https:\/\/weebcentral\.com\/series\/([A-Z0-9]+)\/[^"]*"[^>]*data-tip="([^"]*)"/.exec(article);
    if (!link) continue;
    const meta = [...article.matchAll(/<div>([^<]+)<\/div>/g)].map((m) => m[1].trim());
    hits.push({
      id: link[1],
      title: decodeEntities(link[2]),
      kind: meta[0] ?? null,
      year: meta.map(Number).find((n) => n > 1900 && n < 2100) ?? null,
    });
  }
  return hits;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'wa', 'no', 'ga', 'wo', 'ni', 'de', 'to']);

/**
 * The site's search wants every typed word to appear in a title, and it splits
 * words differently around apostrophes and hyphens ("I'm", "Max-Level"). Only the
 * distinctive words survive here: "I’m the Max-Level Newbie" → "Max Level Newbie".
 */
function keywords(title: string): string {
  return title
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 6)
    .join(' ');
}

/** Exact title match, the start year within a year either way, and only readable formats. */
export async function match(titles: string[], year: number | null): Promise<CentralHit | null> {
  for (const title of titles.slice(0, 3)) {
    const t = norm(title);
    for (const query of [...new Set([plainQuery(title), keywords(title)])].filter(Boolean)) {
      const hits = (await search(query)).filter((h) => !h.kind || READABLE_KINDS.includes(h.kind.toLowerCase()));
      const exact = hits.filter((h) => norm(h.title) === t);
      const pick = exact.find((h) => !year || !h.year || Math.abs(h.year - year) <= 1) ?? (exact.length === 1 ? exact[0] : undefined);
      if (pick) return pick;
    }
  }
  return null;
}

export async function chapters(seriesId: string): Promise<Chapter[]> {
  const html = await retry(() => getText(`${BASE}/series/${seriesId}/full-chapter-list`, { timeoutMs: 20000, headers: { 'HX-Request': 'true', Referer: WEEBCENTRAL_REFERER } }));
  const list: Chapter[] = [];
  const seen = new Set<string>();
  const re = /<a href="(?:https:\/\/weebcentral\.com)?\/chapters\/([A-Z0-9]+)"[\s\S]*?<span class="">([^<]+)<\/span>[\s\S]*?<time[^>]*datetime="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const label = decodeEntities(m[2].trim());
    const num = /(\d+(?:\.\d+)?)/.exec(label)?.[1] ?? null;
    const plain = /^(chapter|episode|ch\.?)\s*[\d.]+$/i.test(label);
    list.push({
      id: `weebcentral:${m[1]}`,
      provider: 'weebcentral',
      number: num,
      // "Side Story 3" or "Season 2 Episode 1" keep their wording; plain "Chapter 12" needs none.
      title: plain ? null : label,
      volume: null,
      group: null,
      pages: null,
      publishedAt: Date.parse(m[3]) || null,
      externalUrl: null,
    });
  }
  // Newest first on the site; oldest first everywhere in the app.
  return list.reverse();
}

export async function pages(chapterId: string): Promise<ChapterPage[]> {
  const html = await retry(() =>
    getText(`${BASE}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`, {
      timeoutMs: 15000,
      headers: { 'HX-Request': 'true', Referer: WEEBCENTRAL_REFERER },
    }),
  );
  const urls = [...html.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"[^>]*alt="Page \d+"/g)].map((m) => decodeEntities(m[1]));
  // The image hosts refuse requests without the site's Referer.
  registerRefererHosts(urls, WEEBCENTRAL_REFERER);
  return urls.map((url) => ({ url }));
}

/** A tiny search, used by the health check. */
export async function ping(): Promise<void> {
  await search('one piece');
}
