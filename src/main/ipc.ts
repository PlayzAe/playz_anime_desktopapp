import { app, BrowserWindow, dialog, ipcMain, net, session, shell } from 'electron';
import fs from 'node:fs';
import type { DirKind, PlayerTaskbarState } from '../shared/api';
import type {
  BrowseFilters,
  Chapter,
  DownloadRequest,
  HistoryEntry,
  ListStatus,
  MangaProviderId,
  MediaSnapshot,
  Profile,
  ReadingEntry,
  SetupStatus,
  Settings,
} from '../shared/types';
import * as anilist from './anilist';
import { applyAccentIcon } from './appIcon';
import { downloader } from './downloader';
import { clearEpisodeCache, listEpisodes } from './episodes';
import { clearStreamCache, resolveStream } from './extractor';
import { ffmpegPath } from './ffmpeg';
import { logger } from './log';
import { chapterList, chapterPages, clearMangaCache, listExtensions, providerHealth, toggleExtension } from './manga';
import { setAdblock } from './network';
import { chapterPageCount, offlineItems } from './offline';
import { cleanProfile, exportProfileFile, parseProfileFile, pickProfileFile, takePendingProfile } from './profiles';
import { setMangadexAdult } from './sources/mangadex';
import { store } from './store';
import { allowThroughGuard, folderGuard } from './windowsGuard';

const log = logger('ipc');

type Handler = (...args: never[]) => unknown;

/**
 * Registers a handler and logs failures once, here, so every renderer call site
 * gets a clean Error message instead of Electron's "Error invoking remote method".
 */
function handle(channel: string, fn: Handler) {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await (fn as (...a: unknown[]) => unknown)(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`${channel} failed: ${message}`);
      throw new Error(message);
    }
  });
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

const dirOf = (kind: DirKind) => (kind === 'manga' ? store().settings.mangaDir : store().settings.animeDir);

export function applySettingsSideEffects(s: Settings) {
  anilist.setHideAdult(s.hideAdult);
  setMangadexAdult(!s.hideAdult);
  setAdblock(s.adblock);
  applyAccentIcon(s.accent);
}

export interface IpcHooks {
  setPlayer: (state: PlayerTaskbarState | null) => void;
}

export function registerIpc(hooks: IpcHooks) {
  // AniList
  handle('anilist:home', (refresh?: boolean) => anilist.home(Boolean(refresh)));
  handle('anilist:mangaHome', (refresh?: boolean) => anilist.mangaHome(Boolean(refresh)));
  handle('anilist:browse', (filters: BrowseFilters) => anilist.browse(filters ?? {}));
  handle('anilist:media', (id: number) => anilist.media(Number(id)));
  handle('anilist:schedule', (from: number, to: number) => anilist.schedule(Number(from), Number(to)));

  // Anime episodes & streams
  handle('episodes:list', (mediaId: number, refresh?: boolean) => listEpisodes(Number(mediaId), Boolean(refresh)));
  handle('stream:resolve', (embedUrl: string, refresh?: boolean) => {
    if (!isHttpUrl(embedUrl)) throw new Error('Invalid embed URL.');
    return resolveStream(embedUrl, Boolean(refresh));
  });

  // Manga
  handle('manga:chapters', (mediaId: number, provider?: MangaProviderId | null, refresh?: boolean) =>
    chapterList(Number(mediaId), provider ?? null, Boolean(refresh)),
  );
  handle('manga:health', (force?: boolean) => providerHealth(Boolean(force)));
  handle('manga:pages', (chapter: Chapter) => {
    if (!chapter?.id) throw new Error('Unknown chapter.');
    return chapterPages(chapter);
  });
  handle('manga:extensions', () => listExtensions());
  handle('manga:toggleExtension', (id: string, enabled: boolean) => {
    toggleExtension(String(id), Boolean(enabled));
    return { ok: true };
  });

  // Library
  handle('library:all', () => store().library());
  handle('library:set', (media: MediaSnapshot, status: ListStatus) => store().setLibrary(media, status));
  handle('library:remove', (mediaId: number) => store().removeLibrary(Number(mediaId)));

  // Watch history
  handle('history:all', () => store().history());
  handle('history:save', (entry: HistoryEntry) => store().saveHistory(entry));
  handle('history:remove', (mediaId: number) => store().removeHistory(Number(mediaId)));
  handle('history:clear', () => store().clearHistory());
  handle('history:watched', (mediaId: number) => store().watched(Number(mediaId)));
  handle('history:setWatched', (mediaId: number, episodes: number[], watched: boolean) =>
    store().setWatched(Number(mediaId), (episodes ?? []).map(Number), Boolean(watched)),
  );

  // Reading history
  handle('reading:all', () => store().reading());
  handle('reading:save', (entry: ReadingEntry) => store().saveReading(entry));
  handle('reading:remove', (mediaId: number) => store().removeReading(Number(mediaId)));
  handle('reading:read', (mediaId: number) => store().readChapters(Number(mediaId)));
  handle('reading:setRead', (mediaId: number, chapters: string[], read: boolean) =>
    store().setRead(Number(mediaId), (chapters ?? []).map(String), Boolean(read)),
  );

  // Settings
  handle('settings:get', () => store().settings);
  handle('settings:set', (patch: Partial<Settings>) => {
    const next = store().patchSettings(patch ?? {});
    applySettingsSideEffects(next);
    return next;
  });
  handle('settings:chooseDir', async (kind: DirKind) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'manga' ? 'Choose where manga chapters are saved' : 'Choose where anime episodes are saved',
      defaultPath: dirOf(kind),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return store().patchSettings(kind === 'manga' ? { mangaDir: result.filePaths[0] } : { animeDir: result.filePaths[0] });
  });

  // Downloads
  const validRequest = (req: DownloadRequest) => {
    if (req?.kind === 'episode' && isHttpUrl(req.embedUrl)) return true;
    if (req?.kind === 'chapter' && typeof req.chapter?.id === 'string') return true;
    throw new Error('Invalid download request.');
  };
  handle('downloads:list', () => downloader().list());
  handle('downloads:start', (req: DownloadRequest) => validRequest(req) && downloader().start(req));
  handle('downloads:startMany', (reqs: DownloadRequest[]) => downloader().startMany((reqs ?? []).filter(validRequest)));
  handle('downloads:cancel', (id: string) => downloader().cancel(String(id)));
  handle('downloads:retry', (id: string) => downloader().retry(String(id)));
  handle('downloads:pause', (id: string) => downloader().pause(String(id)));
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
  handle('downloads:pauseMany', (list?: string[]) => downloader().pauseMany(ids(list)));
  handle('downloads:resumeMany', (list?: string[]) => downloader().resumeMany(ids(list)));
  handle('downloads:cancelMany', (list?: string[]) => downloader().cancelMany(ids(list)));
  handle('downloads:remove', (id: string, deleteFile?: boolean) => downloader().remove(String(id), Boolean(deleteFile)));
  handle('downloads:clearFinished', () => downloader().clearFinished());
  handle('downloads:open', (id: string) => downloader().open(String(id)));
  handle('downloads:reveal', (id: string) => downloader().reveal(String(id)));
  handle('downloads:missing', () => downloader().missingFiles());
  handle('downloads:rescan', () => downloader().rescan());

  // App
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
  }));
  handle('app:openExternal', async (url: string) => {
    if (!isHttpUrl(url)) throw new Error('Only web links can be opened.');
    await shell.openExternal(url);
  });
  handle('app:openDir', async (kind: DirKind) => {
    const dir = dirOf(kind);
    await fs.promises.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });
  handle('app:clearCache', async () => {
    anilist.clearAnilistCache();
    clearEpisodeCache();
    clearStreamCache();
    clearMangaCache();
    await session.defaultSession.clearCache();
  });
  handle('app:setPlayer', (state: PlayerTaskbarState | null) => hooks.setPlayer(state));
  handle('app:online', () => net.isOnline());

  // First-run setup
  const setupStatus = async (): Promise<SetupStatus> => {
    const [, guard] = await Promise.all([store().ensureDownloadDirs(), folderGuard()]);
    if (guard === 'on') store().displacedDirs('Controlled folder access');
    const s = store().settings;
    return { setupDone: store().setupDone, animeDir: s.animeDir, mangaDir: s.mangaDir, folderIssues: store().folderIssues, guard, online: net.isOnline() };
  };
  // First-run setup shows once ever. `start.bat setup` (PLAYZANIME_FORCE_SETUP) shows it again, for testing.
  let forcedSetupSeen = false;
  const forceSetup = Boolean(process.env.PLAYZANIME_FORCE_SETUP);
  handle('setup:isDone', () => (forceSetup ? forcedSetupSeen : store().setupDone));
  handle('setup:status', setupStatus);
  handle('setup:allowFolders', async () => {
    const approved = await allowThroughGuard([process.execPath, ffmpegPath()]);
    if (approved) {
      // Try the folders the person actually wanted again, now that the app is allowed in.
      const issues = store().folderIssues;
      store().folderIssues = [];
      for (const issue of issues) store().patchSettings(issue.kind === 'manga' ? { mangaDir: issue.wanted } : { animeDir: issue.wanted });
    }
    return { approved, status: await setupStatus() };
  });
  handle('setup:complete', () => {
    forcedSetupSeen = true;
    store().markSetupDone();
  });

  // Profiles
  handle('profile:get', () => store().profile);
  handle('profile:set', (profile: Profile | null) => {
    store().setProfile(profile ? cleanProfile(profile) : null);
    return store().profile;
  });
  handle('profile:export', () => exportProfileFile());
  handle('profile:pick', () => pickProfileFile());
  handle('profile:preview', (text: string) => parseProfileFile(String(text ?? '')));
  handle('profile:import', (text: string) => store().addImported(parseProfileFile(String(text ?? ''))));
  handle('profile:imported', () => store().importedProfiles());
  handle('profile:takePending', () => takePendingProfile());
  handle('profile:removeImported', (id: string) => store().removeImported(String(id)));

  // Offline library
  handle('offline:items', () => offlineItems());
  handle('offline:pageCount', (jobId: string) => chapterPageCount(String(jobId)));
}
