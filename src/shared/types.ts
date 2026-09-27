// Types shared by the main process, the preload bridge and the renderer.

export interface MediaTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
  userPreferred?: string | null;
}

export interface MediaCover {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
  color?: string | null;
}

export interface FuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface NextAiring {
  episode: number;
  airingAt: number;
  timeUntilAiring: number;
}

export type MediaType = 'ANIME' | 'MANGA';
export type MediaFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | 'MANGA' | 'NOVEL' | 'ONE_SHOT';
export type MediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

export interface Media {
  id: number;
  idMal?: number | null;
  type?: MediaType | null;
  title: MediaTitle;
  coverImage?: MediaCover | null;
  bannerImage?: string | null;
  format?: MediaFormat | null;
  status?: MediaStatus | null;
  episodes?: number | null;
  duration?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  countryOfOrigin?: string | null;
  season?: MediaSeason | null;
  seasonYear?: number | null;
  genres?: string[] | null;
  averageScore?: number | null;
  popularity?: number | null;
  description?: string | null;
  isAdult?: boolean | null;
  nextAiringEpisode?: NextAiring | null;
  studios?: { nodes: { name: string }[] } | null;
  staff?: { edges: { role: string; node: { name: { full: string } } }[] } | null;
  startDate?: FuzzyDate | null;
}

export interface MediaRelation {
  relationType: string;
  node: Media;
}

export interface StreamingEpisode {
  title?: string | null;
  thumbnail?: string | null;
}

export interface MediaDetail extends Media {
  synonyms?: string[] | null;
  source?: string | null;
  endDate?: FuzzyDate | null;
  tags?: { name: string; rank: number; isMediaSpoiler: boolean }[] | null;
  trailer?: { id: string; site: string } | null;
  relations?: { edges: MediaRelation[] } | null;
  recommendations?: { nodes: { mediaRecommendation: Media | null }[] } | null;
  streamingEpisodes?: StreamingEpisode[] | null;
  rankings?: { rank: number; type: 'RATED' | 'POPULAR'; allTime: boolean; season?: string | null; year?: number | null; context: string }[] | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  hasNextPage: boolean;
}

export type SortKey = 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'SEARCH_MATCH';

export interface BrowseFilters {
  type?: MediaType;
  page?: number;
  perPage?: number;
  search?: string | null;
  sort?: SortKey;
  genres?: string[];
  formats?: MediaFormat[];
  season?: MediaSeason | null;
  year?: number | null;
  status?: MediaStatus | null;
  /** Manga only: JP, KR (manhwa), CN (manhua). */
  country?: string | null;
}

export interface HomeFeed {
  trending: Media[];
  season: Media[];
  top: Media[];
  seasonLabel: { season: MediaSeason; year: number };
}

export interface MangaFeed {
  trending: Media[];
  manhwa: Media[];
  top: Media[];
}

export interface AiringItem {
  id: number;
  episode: number;
  airingAt: number;
  media: Media;
}

// ── Episodes & streams ──────────────────────────────────────────────────────

export type Audio = 'sub' | 'dub';

export interface Episode {
  number: number;
  title: string;
  subUrl: string | null;
  dubUrl: string | null;
  thumbnail?: string | null;
}

export interface EpisodeList {
  mediaId: number;
  sourceId: number | null;
  /** True when the provider lookup failed and the list was built from AniList's episode count. */
  fallback: boolean;
  hasDub: boolean;
  episodes: Episode[];
}

export interface StreamVariant {
  label: string;
  height: number;
  bandwidth: number;
  url: string;
}

export interface SubtitleTrack {
  label: string;
  url: string;
  isDefault?: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface ResolvedStream {
  embedUrl: string;
  master: string;
  host: string;
  variants: StreamVariant[];
  subtitles: SubtitleTrack[];
  intro: TimeRange | null;
  outro: TimeRange | null;
  resolvedAt: number;
}

// ── Manga ───────────────────────────────────────────────────────────────────

export type MangaProviderId = 'mangadex' | 'asura' | 'weebcentral' | 'flame' | 'mangapill' | (string & {});

export interface MangaExtensionInfo {
  id: string;
  name: string;
  baseUrl: string;
  engine: 'madara' | 'mangastream' | 'mangabox' | 'custom';
  category: 'manhwa' | 'manga' | 'manhua' | 'webtoon';
  note: string;
  enabled: boolean;
  desktopOnly?: boolean;
}

/** Every chapter source, in the order they're shown. */
export const MANGA_PROVIDERS: { id: MangaProviderId; name: string; note: string }[] = [
  { id: 'mangadex', name: 'MangaDex', note: 'Community scanlations with chapter titles and groups' },
  { id: 'asura', name: 'Asura Scans', note: 'Top scanlation source for Korean manhwa and action series' },
  { id: 'weebcentral', name: 'WeebCentral', note: 'Large catalogue, strong on manhwa and manhua' },
  { id: 'flame', name: 'Flame Comics', note: 'New Korean manhwa, often the only English source' },
  { id: 'mangapill', name: 'MangaPill', note: 'Fast, popular manga; a good fallback' },
];

export const providerName = (id: MangaProviderId | null | undefined) => MANGA_PROVIDERS.find((p) => p.id === id)?.name ?? (id || 'the source');

export interface ProviderHealth {
  provider: MangaProviderId;
  ok: boolean;
  /** How long the check took. */
  ms: number;
  checkedAt: number;
  error: string | null;
}

export interface Chapter {
  /** Provider-qualified id, e.g. "mangadex:uuid". */
  id: string;
  provider: MangaProviderId;
  /** Chapter number as the source writes it ("12", "12.5"); null for oneshots. */
  number: string | null;
  title: string | null;
  volume: string | null;
  group: string | null;
  pages: number | null;
  publishedAt: number | null;
  /** Official chapters hosted elsewhere (e.g. MANGA Plus) open in the browser. */
  externalUrl: string | null;
}

export interface ProviderSummary {
  provider: MangaProviderId;
  sourceId: string | null;
  title: string | null;
  chapterCount: number;
  latest: string | null;
  error?: string | null;
}

export interface ChapterList {
  mediaId: number;
  provider: MangaProviderId | null;
  chapters: Chapter[];
  providers: ProviderSummary[];
}

export interface ChapterPage {
  url: string;
  width?: number | null;
  height?: number | null;
}

// ── Local data ──────────────────────────────────────────────────────────────

export type ListStatus = 'watching' | 'planning' | 'completed' | 'paused' | 'dropped';

/** The fields we keep offline so lists render without a network round-trip. */
export interface MediaSnapshot {
  id: number;
  type: MediaType;
  title: string;
  romaji?: string | null;
  native?: string | null;
  cover: string;
  banner?: string | null;
  color?: string | null;
  format?: MediaFormat | null;
  episodes?: number | null;
  chapters?: number | null;
  year?: number | null;
  status?: MediaStatus | null;
}

export interface LibraryEntry {
  media: MediaSnapshot;
  status: ListStatus;
  addedAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  media: MediaSnapshot;
  episode: number;
  episodeTitle?: string | null;
  thumbnail?: string | null;
  position: number;
  duration: number;
  audio: Audio;
  updatedAt: number;
}

export interface ReadingEntry {
  media: MediaSnapshot;
  chapterId: string;
  chapterNumber: string | null;
  chapterTitle?: string | null;
  page: number;
  pages: number;
  updatedAt: number;
}

export type AccentKey = 'shu' | 'matcha' | 'ai' | 'yamabuki' | 'sakura';
export type PlayerMode = 'direct' | 'embed';
export type QualityPref = 'best' | '1080' | '720' | '480';
export type ReaderMode = 'vertical' | 'paged';
export type ReaderDirection = 'rtl' | 'ltr';
export type ReaderFit = 'width' | 'height';

export interface Settings {
  accent: AccentKey;
  titleLanguage: 'english' | 'romaji';
  showNativeTitles: boolean;
  player: PlayerMode;
  preferDub: boolean;
  autoplayNext: boolean;
  autoSkipIntro: boolean;
  quality: QualityPref;
  volume: number;
  subtitleLanguage: string;
  animeDir: string;
  mangaDir: string;
  readerMode: ReaderMode;
  readerDirection: ReaderDirection;
  readerFit: ReaderFit;
  mangaProvider: MangaProviderId | 'auto';
  adblock: boolean;
  hideAdult: boolean;
  notifyDownloads: boolean;
  /** Smaller video buffers, capped quality, compressed manga pages. For metered connections. */
  dataSaver: boolean;
}

// ── Downloads ───────────────────────────────────────────────────────────────

export type DownloadState = 'queued' | 'resolving' | 'downloading' | 'muxing' | 'done' | 'error' | 'cancelled';

export interface EpisodeDownloadRequest {
  kind: 'episode';
  media: MediaSnapshot;
  episode: number;
  episodeTitle?: string | null;
  audio: Audio;
  embedUrl: string;
  quality: QualityPref;
  subtitleLabel?: string | null;
}

export interface ChapterDownloadRequest {
  kind: 'chapter';
  media: MediaSnapshot;
  chapter: Chapter;
}

export type DownloadRequest = EpisodeDownloadRequest | ChapterDownloadRequest;

export interface DownloadJob {
  id: string;
  kind: 'episode' | 'chapter';
  media: MediaSnapshot;
  /** "E07 · The Journey's End" / "Ch. 147 · Title" */
  label: string;
  // episode jobs
  episode?: number;
  audio?: Audio;
  quality?: QualityPref;
  embedUrl?: string;
  subtitleLabel?: string | null;
  // chapter jobs
  chapter?: Chapter;

  state: DownloadState;
  /** Free-form stage text shown under the progress bar ("Fetching ffmpeg (12 MB)"). */
  stage?: string | null;
  /** 0..1 */
  progress: number;
  bytes: number;
  /** bytes per second, smoothed */
  speed: number;
  partsDone: number;
  partsTotal: number;
  resolution?: string | null;
  outputFile?: string | null;
  subtitleFile?: string | null;
  error?: string | null;
  createdAt: number;
  finishedAt?: number | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  userData: string;
  packaged: boolean;
}

// ── First-run setup ─────────────────────────────────────────────────────────

/** Windows Defender "Controlled folder access": off, on (blocking) or audit-only. */
export type FolderGuard = 'off' | 'on' | 'audit' | 'unknown';

export interface SetupStatus {
  setupDone: boolean;
  animeDir: string;
  mangaDir: string;
  /** Folders we couldn't use and what we used instead. */
  folderIssues: { kind: 'anime' | 'manga'; wanted: string; usedInstead: string; reason: string }[];
  guard: FolderGuard;
  online: boolean;
}

// ── Profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string;
  /** Small PNG/JPEG as a data URL, kept offline. */
  avatar: string | null;
  tagline: string | null;
  favorites: MediaSnapshot[];
  createdAt: number;
}

/** What a .playzanime file carries when someone shares their profile. */
export interface ProfileExport {
  format: 'playzanime-profile';
  version: 1;
  exportedAt: number;
  profile: Profile;
  library: LibraryEntry[];
  history: HistoryEntry[];
  reading: ReadingEntry[];
}

/** Someone else's profile, imported into its own space; never mixed into ours. */
export interface ImportedProfile extends ProfileExport {
  importedAt: number;
}

// ── Offline library ─────────────────────────────────────────────────────────

export interface OfflineItem {
  jobId: string;
  kind: 'episode' | 'chapter';
  media: MediaSnapshot;
  label: string;
  episode?: number;
  /** The provider's chapter id, so offline reading progress carries over. */
  chapterId?: string | null;
  chapterNumber?: string | null;
  quality?: string | null;
  audio?: Audio;
  /** A subtitle file sits next to the video. */
  subtitles: boolean;
  file: string;
  bytes: number;
  finishedAt: number;
}
