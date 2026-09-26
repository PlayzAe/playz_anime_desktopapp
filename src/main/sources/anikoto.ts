import { parse } from 'node-html-parser';
import { getJson, getText, retry } from '../http';
import { logger } from '../log';

const log = logger('anikoto');

const API = 'https://anikotoapi.site';
const SEARCH_DOMAINS = ['https://anikoto.cz', 'https://anikototv.to'];
export const MEGAPLAY = 'https://megaplay.buzz';

export interface SearchHit {
  id: number;
  title: string;
  type: string;
  subEpisodes: number;
}

export interface SourceEpisode {
  number: number;
  title: string | null;
  embedId: string | null;
  sub: string | null;
  dub: string | null;
}

export interface SourceSeries {
  id: number;
  malId: number | null;
  aniId: string | null;
  title: string;
  episodes: SourceEpisode[];
}

interface ApiSeries {
  ok?: boolean;
  data?: {
    anime?: { id: number; title?: string; mal_id?: string | number | null; ani_id?: string | number | null };
    episodes?: {
      number: number;
      title?: string | null;
      episode_embed_id?: string | number | null;
      embed_url?: { sub?: string | null; dub?: string | null } | null;
    }[];
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The provider sends titles HTML-escaped ("The Journey&#39;s End"). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export async function search(keyword: string): Promise<SearchHit[]> {
  for (const domain of SEARCH_DOMAINS) {
    try {
      const html = await getText(`${domain}/search?keyword=${encodeURIComponent(keyword)}`, { timeoutMs: 12000 });
      const root = parse(html);
      const hits: SearchHit[] = [];
      for (const item of root.querySelectorAll('#list-items .item, .items .item')) {
        const tip = item.querySelector('[data-tip]');
        const id = Number(tip?.getAttribute('data-tip'));
        if (!Number.isInteger(id) || id <= 0) continue;
        const nameEl = item.querySelector('.info .name') ?? item.querySelector('.name') ?? item.querySelector('a');
        const type = item.querySelector('.meta .right')?.text.trim() ?? '';
        const eps = Number((item.querySelector('.ep-status.sub')?.text ?? '').replace(/\D/g, '')) || 0;
        hits.push({ id, title: decodeEntities(nameEl?.text.trim() ?? ''), type, subEpisodes: eps });
      }
      if (hits.length) return dedupe(hits);
    } catch (err) {
      log.warn(`search failed on ${domain}:`, String(err));
    }
  }
  return [];
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<number>();
  return hits.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/** Same heuristic the Python matcher used, kept as the fallback when MAL ids are missing. */
function score(targetTitle: string, targetFormat: string, targetEps: number | null, hit: SearchHit): number {
  let s = 0;
  const t = norm(targetTitle);
  const h = norm(hit.title);
  if (h === t) s += 120;
  else if (h.startsWith(t)) s += 35;
  else if (h.includes(t)) s += 15;
  else s -= 20;

  const fmt = (targetFormat || 'TV').toUpperCase();
  const type = hit.type.toUpperCase();
  if (type && (fmt.includes(type) || type.includes(fmt))) s += 60;
  else if (fmt === 'TV' && ['MOVIE', 'SPECIAL', 'OVA'].includes(type)) s -= 60;

  const eps = hit.subEpisodes;
  if (targetEps && targetEps > 1) {
    if (eps === targetEps) s += 100;
    else if (eps > 1) s += 40;
    else if (eps === 1 && fmt === 'TV') s -= 50;
  } else if (targetEps === 1 || fmt === 'MOVIE') {
    if (eps === 1) s += 50;
    else if (eps > 1) s -= 30;
  } else if (fmt === 'TV' && eps > 1) {
    s += 45;
  }
  return s;
}

export async function series(id: number): Promise<SourceSeries | null> {
  try {
    const json = await retry(() => getJson<ApiSeries>(`${API}/series/${id}`, { timeoutMs: 12000 }), 3);
    const data = json.data;
    if (!data?.anime) return null;
    const malRaw = Number(data.anime.mal_id);
    return {
      id,
      malId: Number.isFinite(malRaw) && malRaw > 0 ? malRaw : null,
      aniId: data.anime.ani_id ? String(data.anime.ani_id) : null,
      title: data.anime.title ?? '',
      episodes: (data.episodes ?? []).map((e) => ({
        number: Number(e.number),
        title: e.title ? decodeEntities(e.title) : null,
        embedId: e.episode_embed_id != null ? String(e.episode_embed_id) : null,
        sub: e.embed_url?.sub ?? null,
        dub: e.embed_url?.dub ?? null,
      })),
    };
  } catch (err) {
    log.warn(`series ${id} failed:`, String(err));
    return null;
  }
}

export interface MatchTarget {
  titles: string[];
  format: string;
  episodes: number | null;
  malId: number | null;
}

/**
 * Finds the provider's series for an AniList entry. MAL ids give an exact match;
 * the title/format/episode score only decides when no candidate carries one.
 */
export async function match(target: MatchTarget): Promise<SourceSeries | null> {
  const scored = new Map<number, { hit: SearchHit; score: number }>();
  const loaded = new Map<number, SourceSeries | null>();
  const top = () => [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 6);

  for (const title of target.titles) {
    for (const hit of await search(title)) {
      const s = score(title, target.format, target.episodes, hit);
      const prev = scored.get(hit.id);
      if (!prev || prev.score < s) scored.set(hit.id, { hit, score: s });
    }
    if (target.malId) {
      // Best-scored candidates first, two at a time: the right one is usually in the first pair.
      const pending = top().filter((r) => !loaded.has(r.hit.id));
      for (let i = 0; i < pending.length; i += 2) {
        const pair = pending.slice(i, i + 2);
        const results = await Promise.all(pair.map((r) => series(r.hit.id)));
        pair.forEach((r, j) => loaded.set(r.hit.id, results[j]));
        const exact = results.find((s) => s && s.malId === target.malId);
        if (exact) return exact;
      }
    } else if ((top()[0]?.score ?? 0) >= 200) {
      // A near-certain title match on the first query saves the second search.
      break;
    }
  }

  for (const r of top()) {
    if (r.score < 40) break;
    const s = loaded.has(r.hit.id) ? loaded.get(r.hit.id)! : await series(r.hit.id);
    if (!s || !s.episodes.length) continue;
    // With a MAL id on both sides, a mismatch means it is a different show.
    if (target.malId && s.malId && s.malId !== target.malId) continue;
    // A TV series matched to a single "Full" episode is a movie with the same name.
    const onlyFull = s.episodes.length === 1 && (s.episodes[0].title ?? '').trim().toLowerCase() === 'full';
    if (target.format === 'TV' && (target.episodes ?? 0) > 1 && onlyFull) continue;
    return s;
  }
  return null;
}
