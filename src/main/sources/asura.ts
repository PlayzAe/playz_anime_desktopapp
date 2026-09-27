import type { Chapter, ChapterPage } from '../../shared/types';
import { getText, retry } from '../http';
import { decodeEntities } from './anikoto';

/*
 * Asura Scans: premier scanlation source for top Korean manhwa and webtoons
 * (Solo Leveling, Return of the Disaster-Class Hero, Nano Machine, etc.).
 */

const BASE = 'https://asurascans.com';
export const ASURA_REFERER = `${BASE}/`;

const norm = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]/g, '');

export async function search(query: string): Promise<{ id: string; title: string }[]> {
  const url = `${BASE}/browse/comics?q=${encodeURIComponent(query)}`;
  const html = await retry(() =>
    getText(url, {
      timeoutMs: 15000,
      headers: {
        Referer: ASURA_REFERER,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }),
  );

  const hits: { id: string; title: string }[] = [];
  const seen = new Set<string>();

  // Extract from comic card links: <a href="/comics/<slug>">Title</a>
  const linkMatches = html.matchAll(/<a[^>]*href="\/comics\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const m of linkMatches) {
    const slug = m[1];
    if (seen.has(slug) || slug === 'comics' || slug.includes('/chapter/')) continue;
    const clean = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (!clean || /^\d+(\.\d+)?$/.test(clean)) continue;
    seen.add(slug);
    hits.push({
      id: slug,
      title: clean,
    });
  }

  return hits;
}

export async function match(titles: string[], _year: number | null): Promise<{ id: string; title: string } | null> {
  for (const title of titles) {
    if (!title) continue;
    const hits = await search(title).catch(() => []);
    if (!hits.length) continue;
    const targetNorm = norm(title);
    const hit = hits.find((h) => {
      const hn = norm(h.title);
      return hn === targetNorm || hn.includes(targetNorm) || targetNorm.includes(hn);
    });
    if (hit) return hit;
    if (hits.length > 0) return hits[0];
  }
  return null;
}

export async function chapters(seriesSlug: string): Promise<Chapter[]> {
  const url = `${BASE}/comics/${seriesSlug}`;
  const html = await retry(() =>
    getText(url, {
      timeoutMs: 20000,
      headers: { Referer: ASURA_REFERER },
    }),
  );

  const seen = new Set<string>();
  const list: Chapter[] = [];
  const re = new RegExp(`href="(/comics/${seriesSlug}/chapter/([^"]+))"`, 'g');
  for (const m of html.matchAll(re)) {
    const rawNum = m[2];
    if (seen.has(rawNum)) continue;
    seen.add(rawNum);
    const n = Number(rawNum);
    list.push({
      id: `asura:${seriesSlug}/${rawNum}`,
      provider: 'asura',
      number: Number.isFinite(n) ? String(n) : rawNum,
      title: `Chapter ${rawNum}`,
      volume: null,
      group: 'Asura Scans',
      pages: null,
      publishedAt: null,
      externalUrl: null,
    });
  }

  // Oldest first everywhere in the app
  return list.sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
}

export async function pages(sourceId: string): Promise<ChapterPage[]> {
  const cleanId = sourceId.replace(/^asura:/, '');
  const [seriesSlug, chapterNum] = cleanId.split('/');
  const url = `${BASE}/comics/${seriesSlug}/chapter/${chapterNum}`;
  const html = await retry(() =>
    getText(url, {
      timeoutMs: 15000,
      headers: { Referer: ASURA_REFERER },
    }),
  );

  const urls = [...new Set(html.match(/https:\/\/[^"\s\\]+\/asura-images\/chapters\/[^"\s\\]+\/[0-9]+\/[^"\s\\]+\.webp(?:\?[^"\s\\]*)?/g) ?? [])];
  if (!urls.length) {
    const allImgs = [...new Set(html.match(/https:\/\/[^"\s\\]+\/[^"\s\\]+\.(?:webp|jpg|jpeg|png)(?:\?[^"\s\\]*)?/g) ?? [])];
    const filtered = allImgs.filter((u) => u.includes('chapter') || u.includes('storage') || u.includes('cdn'));
    return (filtered.length ? filtered : allImgs).map((url) => ({ url }));
  }
  return urls.map((url) => ({ url }));
}

export async function ping(): Promise<void> {
  await search('solo');
}
