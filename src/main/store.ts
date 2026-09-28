import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DownloadJob,
  HistoryEntry,
  ImportedProfile,
  LibraryEntry,
  Profile,
  ProfileExport,
  ListStatus,
  MediaSnapshot,
  ReadingEntry,
  Settings,
} from '../shared/types';
import { logger } from './log';

const log = logger('store');

/** Rejects if `p` hasn't settled in `ms`. Used for file calls into folders Windows may be guarding. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(message), { code: 'ETIMEDOUT' })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Creates `dir` and writes a probe file into it; throws when Windows refuses or stalls. */
export async function probeDir(dir: string) {
  await withTimeout(fs.promises.mkdir(dir, { recursive: true }), 15_000, `Windows didn't let PlayzAnime create ${dir}`);
  const probe = path.join(dir, `.playzanime-write-test-${process.pid}`);
  await withTimeout(fs.promises.writeFile(probe, ''), 15_000, `Windows didn't let PlayzAnime write to ${dir}`);
  await fs.promises.unlink(probe).catch(() => {});
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface StoreData {
  version: 2;
  settings: Settings;
  library: Record<string, LibraryEntry>;
  history: Record<string, HistoryEntry>;
  watched: Record<string, number[]>;
  reading: Record<string, ReadingEntry>;
  read: Record<string, string[]>;
  downloads: DownloadJob[];
  window: WindowState;
  setupDone: boolean;
  profile: Profile | null;
  imported: ImportedProfile[];
}

function defaultSettings(): Settings {
  return {
    accent: 'shu',
    titleLanguage: 'english',
    showNativeTitles: true,
    player: 'direct',
    preferDub: false,
    autoplayNext: true,
    autoSkipIntro: false,
    quality: 'best',
    volume: 1,
    subtitleLanguage: 'English',
    animeDir: path.join(app.getPath('desktop'), 'PlayzAnime'),
    mangaDir: path.join(app.getPath('desktop'), 'PlayzManga'),
    readerMode: 'vertical',
    readerDirection: 'rtl',
    readerFit: 'width',
    mangaProvider: 'auto',
    adblock: true,
    hideAdult: true,
    notifyDownloads: true,
    maxDownloads: 3,
    dataSaver: false,
  };
}

function defaults(): StoreData {
  return {
    version: 2,
    settings: defaultSettings(),
    library: {},
    history: {},
    watched: {},
    reading: {},
    read: {},
    downloads: [],
    window: { width: 1360, height: 860, maximized: false },
    setupDone: false,
    profile: null,
    imported: [],
  };
}

const MAX_HISTORY = 80;
/** Failed and cancelled entries kept; finished and unfinished downloads are never dropped. */
const MAX_FAILED_RECORDS = 200;

class Store {
  private data: StoreData;
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.file = path.join(app.getPath('userData'), 'playzanime-data.json');
    this.data = this.load();
  }

  private load(): StoreData {
    const base = defaults();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreData> & { settings?: Partial<Settings> & { downloadDir?: string } };
      const settings = { ...base.settings, ...raw.settings };
      // v1 had one downloadDir for everything.
      if (raw.settings?.downloadDir && !raw.settings.animeDir) settings.animeDir = raw.settings.downloadDir;
      delete (settings as { downloadDir?: string }).downloadDir;
      // Earlier builds defaulted to Videos\PlayzAnime and Documents\PlayzAnime Manga.
      const oldAnime = [path.join(app.getPath('videos'), 'PlayzAnime'), path.join(app.getPath('downloads'), 'PlayzAnime')];
      const oldManga = [path.join(app.getPath('documents'), 'PlayzAnime Manga'), path.join(app.getPath('documents'), 'PlayzAnime')];
      if (oldAnime.includes(settings.animeDir)) settings.animeDir = base.settings.animeDir;
      if (oldManga.includes(settings.mangaDir)) settings.mangaDir = base.settings.mangaDir;
      // Library entries from v1 were always anime.
      const library = raw.library ?? {};
      for (const e of Object.values(library)) e.media.type ??= 'ANIME';
      return {
        ...base,
        ...raw,
        version: 2,
        settings,
        window: { ...base.window, ...raw.window },
        library,
        history: raw.history ?? {},
        watched: raw.watched ?? {},
        reading: raw.reading ?? {},
        read: raw.read ?? {},
        downloads: raw.downloads ?? [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('could not read data file, starting fresh', err);
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch {
          /* nothing to keep */
        }
      }
      return base;
    }
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 400);
  }

  /** Writes to a temp file and renames it, so a crash mid-write never truncates the data. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error('write failed', err);
    }
  }

  // ── Settings ──

  get settings(): Settings {
    return { ...this.data.settings };
  }

  patchSettings(patch: Partial<Settings>): Settings {
    const allowed = Object.keys(defaultSettings());
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    this.data.settings = { ...this.data.settings, ...clean };
    this.schedule();
    return this.settings;
  }

  /**
   * Creates the download folders at startup and proves they are writable. A folder
   * that can't be written (moved drive, protected location) falls back to the default.
   */
  async ensureDownloadDirs() {
    await this.resolveDir('anime');
    await this.resolveDir('manga');
  }

  /** Folder problems seen since launch, for the setup screen and the Downloads page. */
  folderIssues: { kind: 'anime' | 'manga'; wanted: string; usedInstead: string; reason: string }[] = [];

  /**
   * Folders that an earlier launch had to move to Downloads, while the Desktop default
   * is still what the person would want. Setup offers to move them back.
   */
  displacedDirs(reason: string) {
    const defaults = defaultSettings();
    for (const kind of ['anime', 'manga'] as const) {
      const key = kind === 'anime' ? 'animeDir' : 'mangaDir';
      const fallback = path.join(app.getPath('downloads'), kind === 'anime' ? 'PlayzAnime' : 'PlayzManga');
      if (this.data.settings[key] === fallback && defaults[key] !== fallback && !this.folderIssues.some((i) => i.kind === kind)) {
        this.folderIssues.push({ kind, wanted: defaults[key], usedInstead: fallback, reason });
      }
    }
  }

  /**
   * The folder downloads of this kind go to, created and proven writable. Desktop,
   * Documents and Videos can be guarded (Defender "Controlled folder access", OneDrive),
   * where calls fail or stall. Every step is async and time-limited, and a folder that
   * doesn't work falls back to one under Downloads, which Windows leaves open.
   */
  async resolveDir(kind: 'anime' | 'manga'): Promise<string> {
    const key = kind === 'anime' ? 'animeDir' : 'mangaDir';
    const fallback = path.join(app.getPath('downloads'), kind === 'anime' ? 'PlayzAnime' : 'PlayzManga');
    const current = this.data.settings[key];
    try {
      await probeDir(current);
      return current;
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? String(err);
      log.warn(`${key} ${current} is not usable (${reason}); falling back to ${fallback}`);
      if (current !== fallback) {
        await probeDir(fallback);
        this.folderIssues = [...this.folderIssues.filter((i) => i.kind !== kind), { kind, wanted: current, usedInstead: fallback, reason }];
        this.data.settings[key] = fallback;
        this.schedule();
      }
      return fallback;
    }
  }

  // ── First run & profiles ──

  get setupDone(): boolean {
    return this.data.setupDone;
  }

  markSetupDone() {
    this.data.setupDone = true;
    this.schedule();
  }

  get profile(): Profile | null {
    return this.data.profile;
  }

  setProfile(profile: Profile | null) {
    this.data.profile = profile;
    this.schedule();
  }

  /** Everything a friend needs to see what we watch and read. Settings and folders stay private. */
  exportProfile(): ProfileExport {
    const profile = this.data.profile ?? { id: 'anonymous', name: 'PlayzAnime viewer', avatar: null, tagline: null, favorites: [], createdAt: Date.now() };
    return { format: 'playzanime-profile', version: 1, exportedAt: Date.now(), profile, library: this.library(), history: this.history(), reading: this.reading() };
  }

  importedProfiles(): ImportedProfile[] {
    return [...this.data.imported].sort((a, b) => b.importedAt - a.importedAt);
  }

  /** Re-importing the same person replaces their earlier copy instead of duplicating it. */
  addImported(p: ProfileExport): ImportedProfile {
    const entry: ImportedProfile = { ...p, importedAt: Date.now() };
    this.data.imported = [entry, ...this.data.imported.filter((x) => x.profile.id !== p.profile.id)];
    this.schedule();
    return entry;
  }

  removeImported(profileId: string) {
    this.data.imported = this.data.imported.filter((x) => x.profile.id !== profileId);
    this.schedule();
  }

  // ── Window ──

  get windowState(): WindowState {
    return { ...this.data.window };
  }

  set windowState(state: WindowState) {
    this.data.window = state;
    this.schedule();
  }

  // ── Library ──

  library(): LibraryEntry[] {
    return Object.values(this.data.library).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  setLibrary(media: MediaSnapshot, status: ListStatus): LibraryEntry[] {
    const key = String(media.id);
    const now = Date.now();
    const prev = this.data.library[key];
    this.data.library[key] = { media, status, addedAt: prev?.addedAt ?? now, updatedAt: now };
    this.schedule();
    return this.library();
  }

  removeLibrary(mediaId: number): LibraryEntry[] {
    delete this.data.library[String(mediaId)];
    this.schedule();
    return this.library();
  }

  /** Opening something from the planning list moves it to watching/reading. */
  private promoteFromPlanning(mediaId: number) {
    const lib = this.data.library[String(mediaId)];
    if (lib && lib.status === 'planning') {
      lib.status = 'watching';
      lib.updatedAt = Date.now();
    }
  }

  // ── Watch history ──

  history(): HistoryEntry[] {
    return Object.values(this.data.history).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  saveHistory(entry: HistoryEntry) {
    this.data.history[String(entry.media.id)] = entry;
    for (const old of this.history().slice(MAX_HISTORY)) delete this.data.history[String(old.media.id)];
    this.promoteFromPlanning(entry.media.id);
    this.schedule();
  }

  removeHistory(mediaId: number): HistoryEntry[] {
    delete this.data.history[String(mediaId)];
    this.schedule();
    return this.history();
  }

  clearHistory() {
    this.data.history = {};
    this.data.watched = {};
    this.data.reading = {};
    this.data.read = {};
    this.schedule();
  }

  watched(mediaId: number): number[] {
    return [...(this.data.watched[String(mediaId)] ?? [])];
  }

  setWatched(mediaId: number, episodes: number[], watched: boolean): number[] {
    const key = String(mediaId);
    const set = new Set(this.data.watched[key] ?? []);
    for (const ep of episodes) {
      if (watched) set.add(ep);
      else set.delete(ep);
    }
    this.data.watched[key] = [...set].sort((a, b) => a - b);
    this.schedule();
    return this.watched(mediaId);
  }

  // ── Reading history ──

  reading(): ReadingEntry[] {
    return Object.values(this.data.reading).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  saveReading(entry: ReadingEntry) {
    this.data.reading[String(entry.media.id)] = entry;
    for (const old of this.reading().slice(MAX_HISTORY)) delete this.data.reading[String(old.media.id)];
    this.promoteFromPlanning(entry.media.id);
    this.schedule();
  }

  removeReading(mediaId: number): ReadingEntry[] {
    delete this.data.reading[String(mediaId)];
    this.schedule();
    return this.reading();
  }

  readChapters(mediaId: number): string[] {
    return [...(this.data.read[String(mediaId)] ?? [])];
  }

  setRead(mediaId: number, chapters: string[], read: boolean): string[] {
    const key = String(mediaId);
    const set = new Set(this.data.read[key] ?? []);
    for (const c of chapters) {
      if (read) set.add(c);
      else set.delete(c);
    }
    this.data.read[key] = [...set];
    this.schedule();
    return this.readChapters(mediaId);
  }

  // ── Download records ──

  downloadRecords(): DownloadJob[] {
    return [...this.data.downloads];
  }

  saveDownloadRecords(jobs: DownloadJob[]) {
    // Finished downloads are the offline library and unfinished ones are the queue, so both are
    // always kept, however many there are. Only old failed and cancelled entries are trimmed.
    let failed = 0;
    this.data.downloads = jobs.filter((j) => !(j.state === 'error' || j.state === 'cancelled') || ++failed <= MAX_FAILED_RECORDS);
    this.schedule();
  }
}

let instance: Store | null = null;
export function store(): Store {
  instance ??= new Store();
  return instance;
}
