import type {
  MangaExtensionInfo,
  AiringItem,
  AppInfo,
  BrowseFilters,
  Chapter,
  ChapterList,
  ChapterPage,
  DownloadJob,
  DownloadRequest,
  EpisodeList,
  HistoryEntry,
  HomeFeed,
  ImportedProfile,
  LibraryEntry,
  ListStatus,
  MangaFeed,
  MangaProviderId,
  Media,
  MediaDetail,
  MediaSnapshot,
  MediaType,
  OfflineItem,
  Paged,
  Profile,
  ProfileExport,
  ProviderHealth,
  ReadingEntry,
  ResolvedStream,
  SetupStatus,
  Settings,
} from './types';

export type DirKind = 'anime' | 'manga';

/**
 * Everything the renderer can ask of the main process. The preload script
 * exposes this object as `window.playzanime`; each method maps to one IPC channel.
 */
export interface PlayzAnimeApi {
  anilist: {
    home(refresh?: boolean): Promise<HomeFeed>;
    mangaHome(refresh?: boolean): Promise<MangaFeed>;
    browse(filters: BrowseFilters): Promise<Paged<Media>>;
    media(id: number, type?: MediaType): Promise<MediaDetail>;
    schedule(fromUnix: number, toUnix: number): Promise<AiringItem[]>;
  };
  episodes: {
    list(mediaId: number, refresh?: boolean): Promise<EpisodeList>;
  };
  stream: {
    resolve(embedUrl: string, refresh?: boolean): Promise<ResolvedStream>;
  };
  manga: {
    chapters(mediaId: number, provider?: MangaProviderId | null, refresh?: boolean): Promise<ChapterList>;
    pages(chapter: Chapter): Promise<ChapterPage[]>;
    /** Pings every chapter source; results are kept for 10 minutes unless forced. */
    health(force?: boolean): Promise<ProviderHealth[]>;
    extensions?(): Promise<MangaExtensionInfo[]>;
    toggleExtension?(id: string, enabled: boolean): Promise<{ ok: boolean }>;
  };
  library: {
    all(): Promise<LibraryEntry[]>;
    set(media: MediaSnapshot, status: ListStatus): Promise<LibraryEntry[]>;
    remove(mediaId: number): Promise<LibraryEntry[]>;
  };
  history: {
    all(): Promise<HistoryEntry[]>;
    save(entry: HistoryEntry): Promise<void>;
    remove(mediaId: number): Promise<HistoryEntry[]>;
    clear(): Promise<void>;
    watched(mediaId: number): Promise<number[]>;
    setWatched(mediaId: number, episodes: number[], watched: boolean): Promise<number[]>;
  };
  reading: {
    all(): Promise<ReadingEntry[]>;
    save(entry: ReadingEntry): Promise<void>;
    remove(mediaId: number): Promise<ReadingEntry[]>;
    read(mediaId: number): Promise<string[]>;
    setRead(mediaId: number, chapterNumbers: string[], read: boolean): Promise<string[]>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    chooseDir(kind: DirKind): Promise<Settings | null>;
  };
  downloads: {
    list(): Promise<DownloadJob[]>;
    start(req: DownloadRequest): Promise<DownloadJob>;
    startMany(reqs: DownloadRequest[]): Promise<number>;
    cancel(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    remove(id: string, deleteFile?: boolean): Promise<void>;
    clearFinished(): Promise<void>;
    open(id: string): Promise<boolean>;
    reveal(id: string): Promise<boolean>;
    /** Ids of finished downloads whose file is no longer where it was saved. */
    missing(): Promise<string[]>;
    onUpdate(listener: (jobs: DownloadJob[]) => void): () => void;
  };
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    openDir(kind: DirKind): Promise<void>;
    clearCache(): Promise<void>;
    /** Drives the Windows taskbar thumbnail buttons while a video is open; null clears them. */
    setPlayer(state: PlayerTaskbarState | null): Promise<void>;
    /** Dynamically updates the Windows app and taskbar icon to match the user's accent color. */
    onCommand(listener: (command: AppCommand) => void): () => void;
    /** What the operating system reports; the page also listens to online/offline events. */
    online(): Promise<boolean>;
  };
  setup: {
    /** Cheap check made on every launch. */
    isDone(): Promise<boolean>;
    /** Checks folders and Windows folder protection; takes a second or two. */
    status(): Promise<SetupStatus>;
    /** Asks Windows (admin prompt) to let PlayzAnime write to protected folders. */
    allowFolders(): Promise<{ approved: boolean; status: SetupStatus }>;
    complete(): Promise<void>;
  };
  profile: {
    get(): Promise<Profile | null>;
    set(profile: Profile | null): Promise<Profile | null>;
    /** Saves a .playzanime file; resolves to its path, or null if cancelled. */
    export(): Promise<string | null>;
    /** Opens a file picker and returns the file's text, or null if cancelled. */
    pick(): Promise<string | null>;
    /** Validates a profile file without importing it. */
    preview(text: string): Promise<ProfileExport>;
    import(text: string): Promise<ImportedProfile>;
    imported(): Promise<ImportedProfile[]>;
    removeImported(profileId: string): Promise<void>;
    /** A profile file opened from Explorer, waiting to be imported (taken once). */
    takePending(): Promise<string | null>;
    /** Fires when a profile file is opened from Explorer while the app is running. */
    onIncoming(listener: () => void): () => void;
  };
  offline: {
    items(): Promise<OfflineItem[]>;
    pageCount(jobId: string): Promise<number>;
  };
}

/** Downloaded files play from here: an episode at `${OFFLINE_MEDIA}/<jobId>`, a chapter page at `.../<jobId>/<index>`. */
export const OFFLINE_MEDIA = 'pzmedia://job';

export interface PlayerTaskbarState {
  playing: boolean;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Commands the main process sends to the page (taskbar buttons, media keys). */
export type AppCommand = 'player:toggle' | 'player:next' | 'player:prev';

declare global {
  interface Window {
    playzanime: PlayzAnimeApi;
  }
}
