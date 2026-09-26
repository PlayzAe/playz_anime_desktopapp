import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  DownloadJob,
  HistoryEntry,
  ImportedProfile,
  LibraryEntry,
  ListStatus,
  MediaSnapshot,
  Profile,
  ReadingEntry,
  Settings,
} from '../../shared/types';

const api = () => window.playzanime;

// ── Toasts ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'default' | 'error';
}

// ── App data ────────────────────────────────────────────────────────────────

interface AppData {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;

  library: LibraryEntry[];
  statusOf: (mediaId: number) => ListStatus | null;
  setStatus: (media: MediaSnapshot, status: ListStatus | null) => Promise<void>;

  history: HistoryEntry[];
  historyFor: (mediaId: number) => HistoryEntry | undefined;
  saveHistory: (entry: HistoryEntry) => void;
  removeHistory: (mediaId: number) => Promise<void>;

  reading: ReadingEntry[];
  readingFor: (mediaId: number) => ReadingEntry | undefined;
  saveReading: (entry: ReadingEntry) => void;
  removeReading: (mediaId: number) => Promise<void>;

  clearAllHistory: () => Promise<void>;

  downloads: DownloadJob[];

  /** Our own profile; null until someone sets one up. */
  profile: Profile | null;
  saveProfile: (profile: Profile | null) => Promise<void>;
  /** Profiles friends shared with us. */
  imported: ImportedProfile[];
  refreshImported: () => Promise<void>;

  online: boolean;

  toasts: Toast[];
  toast: (text: string, opts?: Omit<Toast, 'id' | 'text'>) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppDataProvider');
  return v;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [reading, setReading] = useState<ReadingEntry[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [imported, setImported] = useState<ImportedProfile[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    void Promise.all([
      api().settings.get(),
      api().library.all(),
      api().history.all(),
      api().reading.all(),
      api().downloads.list(),
      api().profile.get(),
      api().profile.imported(),
    ]).then(([s, l, h, r, d, p, i]) => {
      // Before the first paint, so the opening is already in the chosen accent.
      document.documentElement.dataset.accent = s.accent;
      setSettings(s);
      setLibrary(l);
      setHistory(h);
      setReading(r);
      setDownloads(d);
      setProfile(p);
      setImported(i);
    });
    return api().downloads.onUpdate(setDownloads);
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const saveProfile = useCallback(async (p: Profile | null) => {
    setProfile(await api().profile.set(p));
  }, []);
  const refreshImported = useCallback(async () => setImported(await api().profile.imported()), []);

  useEffect(() => {
    if (settings) document.documentElement.dataset.accent = settings.accent;
  }, [settings?.accent]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<AppData['toast']>(
    (text, opts) => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
      setTimeout(() => dismissToast(id), opts?.action ? 6000 : 3400);
    },
    [dismissToast],
  );

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api().settings.set(patch));
  }, []);

  const statusOf = useCallback((id: number) => library.find((e) => e.media.id === id)?.status ?? null, [library]);

  const setStatus = useCallback(async (media: MediaSnapshot, status: ListStatus | null) => {
    setLibrary(status ? await api().library.set(media, status) : await api().library.remove(media.id));
  }, []);

  const historyFor = useCallback((id: number) => history.find((h) => h.media.id === id), [history]);
  const saveHistory = useCallback((entry: HistoryEntry) => {
    setHistory((h) => [entry, ...h.filter((x) => x.media.id !== entry.media.id)]);
    void api().history.save(entry);
  }, []);
  const removeHistory = useCallback(async (id: number) => setHistory(await api().history.remove(id)), []);

  const readingFor = useCallback((id: number) => reading.find((h) => h.media.id === id), [reading]);
  const saveReading = useCallback((entry: ReadingEntry) => {
    setReading((r) => [entry, ...r.filter((x) => x.media.id !== entry.media.id)]);
    void api().reading.save(entry);
  }, []);
  const removeReading = useCallback(async (id: number) => setReading(await api().reading.remove(id)), []);

  const clearAllHistory = useCallback(async () => {
    await api().history.clear();
    setHistory([]);
    setReading([]);
  }, []);

  const value = useMemo<AppData | null>(
    () =>
      settings && {
        settings,
        updateSettings,
        library,
        statusOf,
        setStatus,
        history,
        historyFor,
        saveHistory,
        removeHistory,
        reading,
        readingFor,
        saveReading,
        removeReading,
        clearAllHistory,
        downloads,
        profile,
        saveProfile,
        imported,
        refreshImported,
        online,
        toasts,
        toast,
        dismissToast,
      },
    [settings, updateSettings, library, statusOf, setStatus, history, historyFor, saveHistory, removeHistory, reading, readingFor, saveReading, removeReading, clearAllHistory, downloads, profile, saveProfile, imported, refreshImported, online, toasts, toast, dismissToast],
  );

  // Settings arrive in a few milliseconds; rendering before then would flash defaults.
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Watched episode numbers for one show, kept in sync with the main process. */
export function useWatched(mediaId: number | null) {
  const [watched, setWatched] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!mediaId) return;
    let live = true;
    void api().history.watched(mediaId).then((w) => live && setWatched(new Set(w)));
    return () => {
      live = false;
    };
  }, [mediaId]);
  const set = useCallback(
    async (episodes: number[], value: boolean) => {
      if (!mediaId) return;
      setWatched(new Set(await api().history.setWatched(mediaId, episodes, value)));
    },
    [mediaId],
  );
  return { watched, setWatched: set };
}

/** Read chapter numbers for one manga. */
export function useReadChapters(mediaId: number | null) {
  const [read, setRead] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!mediaId) return;
    let live = true;
    void api().reading.read(mediaId).then((r) => live && setRead(new Set(r)));
    return () => {
      live = false;
    };
  }, [mediaId]);
  const set = useCallback(
    async (chapters: string[], value: boolean) => {
      if (!mediaId) return;
      setRead(new Set(await api().reading.setRead(mediaId, chapters, value)));
    },
    [mediaId],
  );
  return { read, setRead: set };
}
