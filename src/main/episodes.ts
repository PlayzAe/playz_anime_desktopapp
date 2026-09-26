import type { Episode, EpisodeList, MediaDetail } from '../shared/types';
import * as anilist from './anilist';
import { TtlCache } from './cache';
import { getJson } from './http';
import { logger } from './log';
import { MEGAPLAY, match } from './sources/anikoto';

const log = logger('episodes');
const cache = new TtlCache(200);

const GENERIC_TITLE = /^(episode\s*\d+|ep\.?\s*\d+|full|\d+)$/i;

/** AniList's streamingEpisodes come titled "Episode 3 - Lilies"; index them by number. */
function streamingIndex(media: MediaDetail) {
  const byNumber = new Map<number, { title: string | null; thumbnail: string | null }>();
  for (const se of media.streamingEpisodes ?? []) {
    const m = /^episode\s+(\d+)(?:\s*[-–:]\s*(.+))?$/i.exec((se.title ?? '').trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, { title: m[2]?.trim() || null, thumbnail: se.thumbnail ?? null });
  }
  return byNumber;
}

function expectedEpisodeCount(media: MediaDetail): number {
  if (media.format === 'MOVIE') return 1;
  if (media.episodes) return media.episodes;
  if (media.nextAiringEpisode) return Math.max(1, media.nextAiringEpisode.episode - 1);
  return 12;
}

const KITSU = 'https://kitsu.app/api/edge';
const KITSU_HEADERS = { Accept: 'application/vnd.api+json' };

interface KitsuList<T> {
  data?: T[];
  included?: { id: string; type: string }[];
}

/** Episode stills from Kitsu, found through the MAL id. Only the pages covering missing episodes (first 200) are fetched. */
function kitsuStills(malId: number, need: number[]): Promise<Map<number, string>> {
  return cache.wrap(`stills:${malId}:${need[0]}`, 24 * 3_600_000, async () => {
    const stills = new Map<number, string>();
    const mapping = await getJson<KitsuList<unknown>>(`${KITSU}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item`, { headers: KITSU_HEADERS, timeoutMs: 8000 });
    const kitsuId = mapping.included?.find((i) => i.type === 'anime')?.id;
    if (!kitsuId) return stills;
    const pages = [...new Set(need.map((n) => Math.floor((n - 1) / 20)))].slice(0, 10);
    await Promise.all(
      pages.map(async (p) => {
        const res = await getJson<KitsuList<{ attributes?: { number?: number; thumbnail?: { original?: string } | null } }>>(
          `${KITSU}/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${p * 20}&sort=number`,
          { headers: KITSU_HEADERS, timeoutMs: 8000 },
        ).catch(() => null);
        for (const e of res?.data ?? []) {
          const n = e.attributes?.number;
          const url = e.attributes?.thumbnail?.original;
          if (n && url) stills.set(n, url);
        }
      }),
    );
    return stills;
  });
}

export function listEpisodes(mediaId: number, force = false): Promise<EpisodeList> {
  return cache.wrap(`eps:${mediaId}`, 20 * 60_000, async () => {
    const media = await anilist.media(mediaId);
    const isMovie = media.format === 'MOVIE';
    const titles = [media.title.romaji, media.title.english].filter((t): t is string => Boolean(t));
    const streaming = streamingIndex(media);

    const source = await match({
      titles,
      format: media.format ?? 'TV',
      episodes: expectedEpisodeCount(media),
      malId: media.idMal ?? null,
    }).catch((err) => {
      log.warn(`match failed for ${mediaId}:`, String(err));
      return null;
    });

    let episodes: Episode[] = [];
    if (source) {
      const sorted = [...source.episodes].sort((a, b) => a.number - b.number);
      for (const e of isMovie ? sorted.slice(0, 1) : sorted) {
        const n = isMovie ? 1 : e.number;
        const meta = streaming.get(n);
        const own = (e.title ?? '').trim();
        const title = isMovie
          ? 'Full movie'
          : own && !GENERIC_TITLE.test(own)
            ? own
            : meta?.title ?? `Episode ${n}`;
        episodes.push({
          number: n,
          title,
          subUrl: e.sub ?? (source.aniId ? `${MEGAPLAY}/stream/ani/${source.aniId}/${n}/sub` : null),
          dubUrl: e.dub ?? null,
          thumbnail: meta?.thumbnail ?? null,
        });
      }
      log.info(`matched ${mediaId} → source ${source.id} (${episodes.length} episodes)`);
    }

    // AniList only has stills for shows on Crunchyroll, and often only the first few
    // episodes. Kitsu fills most of the rest; if it's slow, the list doesn't wait.
    const need = episodes.filter((e) => !e.thumbnail).map((e) => e.number);
    if (need.length && media.idMal && !isMovie) {
      const stills = await Promise.race([kitsuStills(media.idMal, need).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      if (stills) for (const e of episodes) e.thumbnail ??= stills.get(e.number) ?? null;
    }

    const fallback = episodes.length === 0;
    if (fallback) {
      const total = expectedEpisodeCount(media);
      episodes = Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const meta = streaming.get(n);
        return {
          number: n,
          title: isMovie ? 'Full movie' : meta?.title ?? `Episode ${n}`,
          subUrl: `${MEGAPLAY}/stream/ani/${mediaId}/${n}/sub`,
          dubUrl: null,
          thumbnail: meta?.thumbnail ?? null,
        };
      });
      log.warn(`no provider match for ${mediaId}; using AniList-id embeds`);
    }

    return {
      mediaId,
      sourceId: source?.id ?? null,
      fallback,
      hasDub: episodes.some((e) => e.dubUrl),
      episodes,
    };
  }, force);
}

export function clearEpisodeCache() {
  cache.clear();
}
