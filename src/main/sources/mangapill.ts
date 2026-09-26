import { parse } from 'node-html-parser';
import type { Chapter, ChapterPage } from '../../shared/types';
import { getText, retry } from '../http';
import { registerRefererHosts } from '../network';
import { decodeEntities } from './anikoto';
import { plainQuery } from './weebcentral';

const BASE = 'https://mangapill.com';
export const MANGAPILL_REFERER = `${BASE}/`;

export interface PillHit {
  path: string;
  title: string;
  altTitle: string | null;
  year: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function search(query: string): Promise<PillHit[]> {
  const html = await retry(() => getText(`${BASE}/search?q=${encodeURIComponent(plainQuery(query))}`, { timeoutMs: 15000 }));
  const root = parse(html);
  const hits: PillHit[] = [];
  const seen = new Set<string>();
  for (const card of root.querySelectorAll('a[href^="/manga/"]')) {
    const path = card.getAttribute('href') ?? '';
    const titleEl = card.querySelector('.font-black');
    if (!titleEl || seen.has(path)) continue;
    seen.add(path);
    const alt = card.querySelector('.text-xs')?.text.trim() || null;
    const tags = card.parentNode?.querySelectorAll('.rounded') ?? [];
    const yearTag = tags.map((t) => t.text.trim()).find((t) => /^\d{4}$/.test(t));
    hits.push({
      path,
      title: decodeEntities(titleEl.text.trim()),
      altTitle: alt ? decodeEntities(alt) : null,
      year: yearTag ? Number(yearTag) : null,
    });
  }
  return hits;
}

const isNovel = (h: PillHit) => /\bnovel\b/i.test(`${h.title} ${h.altTitle ?? ''}`);
const yearFits = (h: PillHit, year: number | null) => !year || !h.year || Math.abs(h.year - year) <= 1;

/**
 * Exact title match first, using the start year to separate remakes and
 * spin-offs. Failing that, a prefix match covers sites that shorten long
 * subtitles ("Kaguya-sama wa Kokurasetai" vs the full AniList romaji), but
 * only when the year agrees, and never for light novels.
 */
export async function match(titles: string[], year: number | null): Promise<PillHit | null> {
  let loose: PillHit | null = null;
  for (const title of titles.slice(0, 3)) {
    const hits = (await search(title)).filter((h) => !isNovel(h));
    const t = norm(title);
    const names = (h: PillHit) => [norm(h.title), h.altTitle ? norm(h.altTitle) : ''].filter(Boolean);
    const exact = hits.filter((h) => names(h).includes(t));
    const pick = exact.find((h) => yearFits(h, year)) ?? exact[0];
    if (pick) return pick;
    loose ??=
      hits.find(
        (h) =>
          year !== null &&
          h.year !== null &&
          yearFits(h, year) &&
          names(h).some((n) => Math.min(n.length, t.length) >= 8 && (n.startsWith(t) || t.startsWith(n))),
      ) ?? null;
  }
  return loose;
}

export async function chapters(path: string): Promise<Chapter[]> {
  const html = await retry(() => getText(`${BASE}${path}`, { timeoutMs: 15000 }));
  const root = parse(html);
  const seen = new Set<string>();
  const list: Chapter[] = [];
  for (const a of root.querySelectorAll('a[href^="/chapters/"]')) {
    const href = a.getAttribute('href') ?? '';
    if (seen.has(href)) continue;
    seen.add(href);
    const text = a.text.trim();
    const num = /chapter\s+([\d.]+)/i.exec(text)?.[1] ?? null;
    list.push({
      id: `mangapill:${href}`,
      provider: 'mangapill',
      number: num,
      title: null,
      volume: null,
      group: null,
      pages: null,
      publishedAt: null,
      externalUrl: null,
    });
  }
  return list.reverse();
}

export async function pages(chapterPath: string): Promise<ChapterPage[]> {
  const html = await retry(() => getText(`${BASE}${chapterPath}`, { timeoutMs: 15000 }));
  const root = parse(html);
  const result = root.querySelectorAll('img.js-page').map((img) => ({
    url: img.getAttribute('data-src') ?? img.getAttribute('src') ?? '',
    width: Number(img.getAttribute('width')) || null,
    height: Number(img.getAttribute('height')) || null,
  }));
  const valid = result.filter((p) => /^https?:\/\//.test(p.url));
  // The image CDN refuses requests without the site's Referer.
  registerRefererHosts(valid.map((p) => p.url), MANGAPILL_REFERER);
  return valid;
}
