import type {
  AiringItem,
  BrowseFilters,
  HomeFeed,
  MangaFeed,
  Media,
  MediaDetail,
  MediaSeason,
  Paged,
} from '../shared/types';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TtlCache } from './cache';
import { HttpError, request, retry } from './http';
import { logger } from './log';

const log = logger('anilist');
const ENDPOINT = 'https://graphql.anilist.co';
const cache = new TtlCache(400);

const MIN = 60_000;

const CARD_FRAGMENT = /* GraphQL */ `
  fragment card on Media {
    id
    idMal
    type
    isAdult
    title { romaji english native userPreferred }
    coverImage { extraLarge large medium color }
    bannerImage
    format
    status
    episodes
    duration
    chapters
    volumes
    countryOfOrigin
    season
    seasonYear
    genres
    averageScore
    popularity
    nextAiringEpisode { episode airingAt timeUntilAiring }
    studios(isMain: true) { nodes { name } }
    startDate { year month day }
  }
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  // AniList answers some list filters sent as explicit null (format_in, format_not_in) with a 500,
  // while leaving the variable out means "no filter". So nulls are never sent.
  const vars = Object.fromEntries(Object.entries(variables).filter(([, v]) => v !== null && v !== undefined));
  return retry(async () => {
    const res = await request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: CARD_FRAGMENT + query, variables: vars }),
      timeoutMs: 15000,
    }).catch((err) => {
      if (err instanceof HttpError) {
        if (err.status === 429) log.warn('rate limited by AniList');
        // GraphQL errors arrive as JSON inside the failed response; surface their text.
        try {
          const messages = (JSON.parse(err.body) as { errors?: { message: string }[] }).errors?.map((e) => e.message);
          if (messages?.length) log.warn(`AniList ${err.status}: ${messages.join('; ')}`);
        } catch {
          /* not JSON */
        }
      }
      throw err;
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
    if (!json.data) throw new Error('AniList returned no data');
    return json.data;
  });
}

let hideAdult = true;
export function setHideAdult(value: boolean) {
  if (hideAdult !== value) cache.clear();
  hideAdult = value;
}

export function clearAnilistCache() {
  cache.clear();
}

const adultVar = () => (hideAdult ? false : null);

/** The AniList season that is airing on the given date. */
export function currentSeason(date = new Date()): { season: MediaSeason; year: number } {
  const m = date.getMonth();
  const season: MediaSeason = m <= 2 ? 'WINTER' : m <= 5 ? 'SPRING' : m <= 8 ? 'SUMMER' : 'FALL';
  return { season, year: date.getFullYear() };
}

// ── Instant start ───────────────────────────────────────────────────────────
// The home feeds are saved to disk. On launch the last copy shows immediately
// while a fresh one loads in the background, so the app never opens to skeletons.

let disk: Record<string, { at: number; value: unknown }> | null = null;
const diskFile = () => path.join(app.getPath('userData'), 'feed-cache.json');

function readDisk() {
  if (!disk) {
    try {
      disk = JSON.parse(fs.readFileSync(diskFile(), 'utf8'));
    } catch {
      disk = {};
    }
  }
  return disk!;
}

function writeDisk(key: string, value: unknown) {
  readDisk()[key] = { at: Date.now(), value };
  fs.writeFile(diskFile(), JSON.stringify(disk), () => {});
}

async function instant<T>(key: string, fetchFresh: () => Promise<T>, force: boolean): Promise<T> {
  const saved = readDisk()[key];
  const firstLoad = cache.get(key) === undefined;
  const fresh = fetchFresh().then((v) => {
    writeDisk(key, v);
    return v;
  });
  if (!force && firstLoad && saved && Date.now() - saved.at < 24 * 3_600_000) {
    fresh.catch((err) => log.warn(`background refresh of ${key} failed:`, String(err)));
    return saved.value as T;
  }
  return fresh;
}

// ── Home feeds ──────────────────────────────────────────────────────────────

const HOME_QUERY = /* GraphQL */ `
  query ($season: MediaSeason, $year: Int, $isAdult: Boolean) {
    trending: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [TRENDING_DESC, POPULARITY_DESC], status_not: NOT_YET_RELEASED, isAdult: $isAdult) {
        ...card
        description(asHtml: false)
      }
    }
    season: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [POPULARITY_DESC], season: $season, seasonYear: $year, isAdult: $isAdult, status_not: NOT_YET_RELEASED) {
        ...card
      }
    }
    top: Page(page: 1, perPage: 24) {
      media(type: ANIME, sort: [SCORE_DESC], status_not: NOT_YET_RELEASED, isAdult: $isAdult, popularity_greater: 30000) {
        ...card
      }
    }
  }
`;

export function home(force = false): Promise<HomeFeed> {
  return instant(`home:${hideAdult}`, () => homeFresh(force), force);
}

function homeFresh(force: boolean): Promise<HomeFeed> {
  const label = currentSeason();
  return cache.wrap(
    `home:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql<{ trending: { media: Media[] }; season: { media: Media[] }; top: { media: Media[] } }>(HOME_QUERY, {
        season: label.season,
        year: label.year,
        isAdult: adultVar(),
      });
      return { trending: data.trending.media, season: data.season.media, top: data.top.media, seasonLabel: label };
    },
    force,
  );
}

const MANGA_HOME_QUERY = /* GraphQL */ `
  query ($isAdult: Boolean) {
    trending: Page(page: 1, perPage: 24) {
      media(type: MANGA, sort: [TRENDING_DESC, POPULARITY_DESC], format_not_in: [NOVEL], isAdult: $isAdult) {
        ...card
        description(asHtml: false)
      }
    }
    manhwa: Page(page: 1, perPage: 24) {
      media(type: MANGA, countryOfOrigin: "KR", sort: [TRENDING_DESC], format_not_in: [NOVEL], isAdult: $isAdult) {
        ...card
      }
    }
    top: Page(page: 1, perPage: 24) {
      media(type: MANGA, sort: [SCORE_DESC], format_not_in: [NOVEL], isAdult: $isAdult, popularity_greater: 20000) {
        ...card
      }
    }
  }
`;

export function mangaHome(force = false): Promise<MangaFeed> {
  return instant(`mangaHome:${hideAdult}`, () => mangaHomeFresh(force), force);
}

function mangaHomeFresh(force: boolean): Promise<MangaFeed> {
  return cache.wrap(
    `mangaHome:${hideAdult}`,
    10 * MIN,
    async () => {
      const data = await gql<{ trending: { media: Media[] }; manhwa: { media: Media[] }; top: { media: Media[] } }>(
        MANGA_HOME_QUERY,
        { isAdult: adultVar() },
      );
      return { trending: data.trending.media, manhwa: data.manhwa.media, top: data.top.media };
    },
    force,
  );
}

// ── Browse & search ─────────────────────────────────────────────────────────

const BROWSE_QUERY = /* GraphQL */ `
  query (
    $type: MediaType, $page: Int, $perPage: Int, $search: String, $sort: [MediaSort], $genres: [String],
    $formats: [MediaFormat], $formatsNot: [MediaFormat], $season: MediaSeason, $year: Int, $status: MediaStatus,
    $statusNot: MediaStatus, $isAdult: Boolean, $country: CountryCode
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(
        type: $type, search: $search, sort: $sort, genre_in: $genres, format_in: $formats, format_not_in: $formatsNot,
        season: $season, seasonYear: $year, status: $status, status_not: $statusNot, isAdult: $isAdult,
        countryOfOrigin: $country
      ) {
        ...card
        description(asHtml: false)
      }
    }
  }
`;

export function browse(filters: BrowseFilters): Promise<Paged<Media>> {
  const type = filters.type ?? 'ANIME';
  const search = filters.search?.trim() || null;
  const sort = filters.sort ?? (search ? 'SEARCH_MATCH' : 'TRENDING_DESC');
  const isManga = type === 'MANGA';
  const vars = {
    type,
    page: filters.page ?? 1,
    perPage: Math.min(filters.perPage ?? 30, 50),
    search,
    sort: sort === 'SEARCH_MATCH' ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : [sort, 'POPULARITY_DESC'],
    genres: filters.genres?.length ? filters.genres : null,
    formats: filters.formats?.length ? filters.formats : null,
    // Novels have nothing to read in the app; music videos have nothing to watch.
    formatsNot: isManga ? ['NOVEL'] : ['MUSIC'],
    season: isManga ? null : (filters.season ?? null),
    // For manga a "year" filter means the start year.
    year: isManga ? null : (filters.year ?? null),
    status: filters.status ?? null,
    // Unreleased anime have nothing to play, so they only appear when asked for explicitly or when searching.
    statusNot: filters.status || search || isManga ? null : 'NOT_YET_RELEASED',
    isAdult: adultVar(),
    country: isManga ? (filters.country ?? null) : null,
  };
  const key = `browse:${JSON.stringify(vars)}`;
  return cache.wrap(key, (search ? 5 : 10) * MIN, async () => {
    const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: Media[] } }>(BROWSE_QUERY, vars);
    return { items: data.Page.media, page: vars.page, hasNextPage: data.Page.pageInfo.hasNextPage };
  });
}

// ── Media detail ────────────────────────────────────────────────────────────

const MEDIA_QUERY = /* GraphQL */ `
  query ($id: Int) {
    Media(id: $id) {
      ...card
      description(asHtml: false)
      synonyms
      source(version: 3)
      endDate { year month day }
      tags { name rank isMediaSpoiler }
      trailer { id site }
      rankings { rank type allTime season year context }
      streamingEpisodes { title thumbnail }
      staff(perPage: 4, sort: [RELEVANCE]) { edges { role node { name { full } } } }
      relations {
        edges {
          relationType(version: 2)
          node { ...card }
        }
      }
      recommendations(perPage: 14, sort: [RATING_DESC]) {
        nodes { mediaRecommendation { ...card } }
      }
    }
  }
`;

export function media(id: number, force = false): Promise<MediaDetail> {
  return cache.wrap(
    `media:${id}`,
    30 * MIN,
    async () => {
      const data = await gql<{ Media: MediaDetail }>(MEDIA_QUERY, { id });
      const m = data.Media;
      if (m.relations) {
        // Light novels have nothing to read or watch in the app.
        m.relations.edges = m.relations.edges.filter((e) => e.node && e.node.format !== 'NOVEL' && !(hideAdult && e.node.isAdult));
      }
      if (m.recommendations) {
        m.recommendations.nodes = m.recommendations.nodes.filter(
          (n) => n.mediaRecommendation && !(hideAdult && n.mediaRecommendation.isAdult),
        );
      }
      return m;
    },
    force,
  );
}

// ── Airing schedule ─────────────────────────────────────────────────────────

const SCHEDULE_QUERY = /* GraphQL */ `
  query ($page: Int, $from: Int, $to: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: [TIME]) {
        id
        episode
        airingAt
        media { ...card }
      }
    }
  }
`;

export function schedule(from: number, to: number): Promise<AiringItem[]> {
  return cache.wrap(`schedule:${from}:${to}:${hideAdult}`, 15 * MIN, async () => {
    const items: AiringItem[] = [];
    for (let page = 1; page <= 8; page++) {
      const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AiringItem[] } }>(
        SCHEDULE_QUERY,
        { page, from, to },
      );
      items.push(...data.Page.airingSchedules);
      if (!data.Page.pageInfo.hasNextPage) break;
    }
    return items.filter((i) => i.media && !(hideAdult && i.media.isAdult));
  });
}
