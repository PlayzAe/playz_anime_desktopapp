import type { Chapter, ChapterList, ChapterPage, MangaProviderId, MediaDetail, ProviderHealth, ProviderSummary } from '../shared/types';
import { MANGA_PROVIDERS } from '../shared/types';
import * as anilist from './anilist';
import { TtlCache } from './cache';
import { logger } from './log';
import * as asura from './sources/asura';
import * as flame from './sources/flame';
import * as mangadex from './sources/mangadex';
import * as mangapill from './sources/mangapill';
import * as weebcentral from './sources/weebcentral';
import { store } from './store';

const log = logger('manga');
const cache = new TtlCache(200);
const MIN = 60_000;

/*
 * Every source answers the same four questions. Adding one means one module
 * and one entry here; matching, health checks and auto-pick come for free.
 */
interface Source {
  /** Finds this series on the source. */
  find(media: MediaDetail): Promise<{ sourceId: string; title: string } | null>;
  chapters(sourceId: string): Promise<Chapter[]>;
  pages(sourceId: string, dataSaver: boolean): Promise<ChapterPage[]>;
  /** Cheapest possible request that proves the source is up. */
  ping(): Promise<unknown>;
  /** Image hosts that need the site as Referer. */
  referer?: string;
}

function titlesFor(media: MediaDetail): string[] {
  const t = media.title;
  return [...new Set([t.romaji, t.english, ...(media.synonyms ?? []).slice(0, 2)].filter((s): s is string => Boolean(s)))];
}

const SOURCES: Record<MangaProviderId, Source> = {
  mangadex: {
    find: async (media) => {
      const hit = await mangadex.findByAnilist(media.id, titlesFor(media));
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => mangadex.chapters(id),
    pages: (id, saver) => mangadex.pages(id, saver),
    ping: () => mangadex.ping(),
  },
  asura: {
    find: async (media) => {
      const hit = await asura.match(titlesFor(media), media.startDate?.year ?? null);
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => asura.chapters(id),
    pages: (id) => asura.pages(id),
    ping: () => asura.ping(),
    referer: asura.ASURA_REFERER,
  },
  weebcentral: {
    find: async (media) => {
      const hit = await weebcentral.match(titlesFor(media), media.startDate?.year ?? null);
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => weebcentral.chapters(id),
    pages: (id) => weebcentral.pages(id),
    ping: () => weebcentral.ping(),
    referer: weebcentral.WEEBCENTRAL_REFERER,
  },
  flame: {
    find: async (media) => {
      const hit = await flame.match(titlesFor(media));
      return hit ? { sourceId: hit.id, title: hit.title } : null;
    },
    chapters: (id) => flame.chapters(id),
    pages: (id) => flame.pages(id),
    ping: () => flame.ping(),
    referer: flame.FLAME_REFERER,
  },
  mangapill: {
    find: async (media) => {
      const hit = await mangapill.match(titlesFor(media), media.startDate?.year ?? null);
      return hit ? { sourceId: hit.path, title: hit.title } : null;
    },
    chapters: (path) => mangapill.chapters(path),
    pages: (path) => mangapill.pages(path),
    ping: () => mangapill.search('one piece'),
    referer: mangapill.MANGAPILL_REFERER,
  },
};

import { extensionRegistry } from './extensions/registry';
import type { MangaExtensionInfo } from '../shared/types';

export function getSource(provider: MangaProviderId): Source | undefined {
  if (SOURCES[provider]) return SOURCES[provider];
  const ext = extensionRegistry.getSource(provider);
  if (ext) {
    return {
      find: (media) => ext.find(media, true),
      chapters: (id) => ext.chapters(id),
      pages: (id) => ext.pages(id),
      ping: () => ext.ping(),
      referer: ext.config.baseUrl,
    };
  }
  return undefined;
}

export function listExtensions(): MangaExtensionInfo[] {
  return extensionRegistry.getAllConfigs() as MangaExtensionInfo[];
}

export function toggleExtension(id: string, enabled: boolean) {
  extensionRegistry.toggle(id, enabled);
}

export function refererFor(provider: MangaProviderId): string | undefined {
  return getSource(provider)?.referer;
}

// ── Health ──────────────────────────────────────────────────────────────────

const health = new Map<MangaProviderId, ProviderHealth>();
const HEALTH_TTL = 10 * MIN;

async function check(provider: MangaProviderId): Promise<ProviderHealth> {
  const started = Date.now();
  try {
    const src = getSource(provider); if (!src) throw new Error("Source not found"); await Promise.race([src.ping(), new Promise((_, reject) => setTimeout(() => reject(new Error('No answer in 10 seconds')), 10_000))]);
    return { provider, ok: true, ms: Date.now() - started, checkedAt: Date.now(), error: null };
  } catch (err) {
    return { provider, ok: false, ms: Date.now() - started, checkedAt: Date.now(), error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pings every source (in parallel, results kept 10 minutes) so dead ones are skipped instead of waited on. */
export async function providerHealth(force = false): Promise<ProviderHealth[]> {
  return Promise.all(
    MANGA_PROVIDERS.map(async ({ id }) => {
      const known = health.get(id);
      if (!force && known && Date.now() - known.checkedAt < HEALTH_TTL) return known;
      const result = await check(id);
      health.set(id, result);
      if (!result.ok) log.warn(`${id} is down: ${result.error}`);
      return result;
    }),
  );
}

// ── Chapters ────────────────────────────────────────────────────────────────

interface ProviderResult {
  summary: ProviderSummary;
  chapters: Chapter[];
}

/** Highest chapter number that can actually be read in the app (not just linked elsewhere). */
function latestReadable(chapters: Chapter[]): string | null {
  let best: number | null = null;
  for (const c of chapters) {
    if (c.externalUrl) continue;
    const n = Number(c.number);
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best === null ? null : String(best);
}

async function loadProvider(provider: MangaProviderId, media: MediaDetail, force: boolean): Promise<ProviderResult> {
  const down = health.get(provider);
  if (!force && down && !down.ok && Date.now() - down.checkedAt < HEALTH_TTL) {
    return { summary: { provider, sourceId: null, title: null, chapterCount: 0, latest: null, error: `Unreachable right now (${down.error})` }, chapters: [] };
  }
  return cache.wrap(
    `chapters:${provider}:${media.id}`,
    20 * MIN,
    async () => {
      try {
        const source = getSource(provider); if (!source) return { summary: { provider, sourceId: null, title: null, chapterCount: 0, latest: null, error: "Source not found" }, chapters: [] };
        const hit = await source.find(media);
        const chapters = hit ? await source.chapters(hit.sourceId) : [];
        return {
          summary: { provider, sourceId: hit?.sourceId ?? null, title: hit?.title ?? null, chapterCount: chapters.length, latest: latestReadable(chapters) },
          chapters,
        };
      } catch (err) {
        log.warn(`${provider} failed for ${media.id}:`, String(err));
        return {
          summary: { provider, sourceId: null, title: null, chapterCount: 0, latest: null, error: err instanceof Error ? err.message : String(err) },
          chapters: [],
        };
      }
    },
    force,
  );
}

const readable = (r: ProviderResult) => r.chapters.filter((c) => !c.externalUrl).length;
const RICHNESS: Record<MangaProviderId, number> = { mangadex: 4, asura: 3, flame: 2, weebcentral: 1, mangapill: 0 };

/**
 * Asks every healthy source in parallel and uses the one that is furthest along
 * in chapters you can read here, unless a source was picked (per series in the
 * UI, or globally in Settings) and it has this title.
 */
export async function chapterList(mediaId: number, provider?: MangaProviderId | null, force = false): Promise<ChapterList> {
  const media = await anilist.media(mediaId);
  // A fresh health check runs alongside, so a source that just went down is skipped next time.
  void providerHealth().catch(() => {});
  const preferred = provider ?? (store().settings.mangaProvider !== 'auto' ? (store().settings.mangaProvider as MangaProviderId) : null);
  const providersToCheck: MangaProviderId[] = MANGA_PROVIDERS.map(({ id }) => id);
  if (preferred && !providersToCheck.includes(preferred)) {
    providersToCheck.push(preferred);
  }
  const results = await Promise.all(providersToCheck.map((id) => loadProvider(id, media, force)));
  let chosen: ProviderResult | undefined;
  if (provider) {
    // User explicitly chose this provider in the UI: always respect their choice
    chosen = results.find((r) => r.summary.provider === provider);
  } else if (store().settings.mangaProvider !== 'auto') {
    // Global user preference: use if it has readable chapters
    chosen = results.find((r) => r.summary.provider === store().settings.mangaProvider && readable(r) > 0);
  }

  if (!chosen) {
    chosen = [...results].sort((a, b) => {
      const diff = Number(b.summary.latest ?? -1) - Number(a.summary.latest ?? -1);
      // Ties go to the source with richer chapter data (titles, groups, volumes).
      return Math.abs(diff) >= 1 ? diff : readable(b) - readable(a) || RICHNESS[b.summary.provider] - RICHNESS[a.summary.provider];
    })[0];
  }

  return {
    mediaId,
    provider: chosen ? chosen.summary.provider : null,
    chapters: chosen?.chapters ?? [],
    providers: results.map((r) => r.summary),
  };
}

export function chapterPages(chapter: Chapter): Promise<ChapterPage[]> {
  let provider: MangaProviderId;
  let sourceId: string;
  if (chapter.id.startsWith('ext:')) {
    const parts = chapter.id.slice(4).split(':');
    provider = `ext:${parts[0]}` as MangaProviderId;
    sourceId = parts.slice(1).join(':');
  } else {
    const [p, ...rest] = chapter.id.split(':');
    provider = p as MangaProviderId;
    sourceId = rest.join(':');
  }
  const source = getSource(provider);
  if (!source) return Promise.reject(new Error('That chapter comes from a source PlayzAnime no longer uses.'));
  // MangaDex@Home URLs are tokenised and expire, so keep them briefly.
  const saver = store().settings.dataSaver;
  return cache.wrap(`pages:${chapter.id}:${saver}`, 5 * MIN, () => source.pages(sourceId, saver));
}

export function clearMangaCache() {
  cache.clear();
  health.clear();
}
