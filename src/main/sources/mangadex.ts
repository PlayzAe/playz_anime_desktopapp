import type { Chapter, ChapterPage } from '../../shared/types';
import { getJson, retry } from '../http';
import { logger } from '../log';

const log = logger('mangadex');
const API = 'https://api.mangadex.org';
// MangaDex asks API clients to identify themselves.
const HEADERS = { 'User-Agent': 'PlayzAnime/0.1 (desktop reader)' };

let adultAllowed = false;
export function setMangadexAdult(allowed: boolean) {
  adultAllowed = allowed;
}

/** MangaDex's own liveness endpoint; answers "pong". */
export async function ping(): Promise<void> {
  const res = await fetch(`${API}/ping`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function ratingParams(): string {
  const ratings = adultAllowed ? ['safe', 'suggestive', 'erotica', 'pornographic'] : ['safe', 'suggestive', 'erotica'];
  return ratings.map((r) => `contentRating[]=${r}`).join('&');
}

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    links?: Record<string, string> | null;
  };
}

interface MdChapter {
  id: string;
  attributes: {
    chapter: string | null;
    title: string | null;
    volume: string | null;
    pages: number;
    externalUrl: string | null;
    readableAt?: string;
    publishAt?: string;
    translatedLanguage: string;
  };
  relationships: { type: string; attributes?: { name?: string } }[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function titlesOf(m: MdManga): string[] {
  return [...Object.values(m.attributes.title), ...m.attributes.altTitles.flatMap((t) => Object.values(t))];
}

/** AniList ids are stored on MangaDex entries (links.al), which makes the match exact. */
export async function findByAnilist(anilistId: number, titles: string[]): Promise<{ id: string; title: string } | null> {
  let fallback: { id: string; title: string } | null = null;
  for (const title of titles.slice(0, 3)) {
    const url = `${API}/manga?title=${encodeURIComponent(title)}&limit=10&${ratingParams()}&order[relevance]=desc`;
    const res = await retry(() => getJson<{ data: MdManga[] }>(url, { headers: HEADERS, timeoutMs: 12000 }));
    for (const m of res.data) {
      const name = m.attributes.title.en ?? Object.values(m.attributes.title)[0] ?? title;
      if (m.attributes.links?.al === String(anilistId)) return { id: m.id, title: name };
      if (!fallback && titlesOf(m).some((t) => norm(t) === norm(title))) fallback = { id: m.id, title: name };
    }
  }
  return fallback;
}

export async function chapters(mangaId: string, language = 'en'): Promise<Chapter[]> {
  const all: MdChapter[] = [];
  for (let offset = 0, page = 0; page < 12; page++, offset += 500) {
    const url =
      `${API}/manga/${mangaId}/feed?translatedLanguage[]=${language}&limit=500&offset=${offset}` +
      `&order[volume]=asc&order[chapter]=asc&includes[]=scanlation_group&${ratingParams()}`;
    const res = await retry(() => getJson<{ data: MdChapter[]; total: number }>(url, { headers: HEADERS, timeoutMs: 15000 }));
    all.push(...res.data);
    if (offset + 500 >= res.total) break;
  }

  // Several groups often translate the same chapter; keep one per number, preferring hosted pages.
  const byNumber = new Map<string, MdChapter>();
  for (const c of all) {
    const key = c.attributes.chapter ?? `oneshot:${c.id}`;
    const prev = byNumber.get(key);
    const hosted = !c.attributes.externalUrl && c.attributes.pages > 0;
    const prevHosted = prev && !prev.attributes.externalUrl && prev.attributes.pages > 0;
    if (!prev || (hosted && !prevHosted)) byNumber.set(key, c);
  }

  return [...byNumber.values()].map((c) => ({
    id: `mangadex:${c.id}`,
    provider: 'mangadex' as const,
    number: c.attributes.chapter,
    title: c.attributes.title || null,
    volume: c.attributes.volume,
    group: c.relationships.find((r) => r.type === 'scanlation_group')?.attributes?.name ?? null,
    pages: c.attributes.pages || null,
    publishedAt: Date.parse(c.attributes.readableAt ?? c.attributes.publishAt ?? '') || null,
    externalUrl: c.attributes.externalUrl,
  }));
}

export async function pages(chapterUuid: string, dataSaver = false): Promise<ChapterPage[]> {
  const res = await retry(() =>
    getJson<{ baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }>(`${API}/at-home/server/${chapterUuid}`, {
      headers: HEADERS,
      timeoutMs: 12000,
    }),
  );
  if (!res.chapter?.data?.length) {
    log.warn(`chapter ${chapterUuid} has no pages`);
    return [];
  }
  // Data-saver files are recompressed JPEGs, often a third of the size.
  if (dataSaver && res.chapter.dataSaver?.length) {
    return res.chapter.dataSaver.map((file) => ({ url: `${res.baseUrl}/data-saver/${res.chapter.hash}/${file}` }));
  }
  return res.chapter.data.map((file) => ({ url: `${res.baseUrl}/data/${res.chapter.hash}/${file}` }));
}
