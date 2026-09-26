import { BrowserWindow, dialog } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { HistoryEntry, LibraryEntry, MediaSnapshot, Profile, ProfileExport, ReadingEntry } from '../shared/types';
import { store } from './store';

/*
 * Profiles are plain JSON files ending in .playzanime. They never leave the
 * machine on their own: people share them however they like (chat, USB, email)
 * and whoever receives one drops it onto the app.
 */

export const PROFILE_EXT = 'playzanime';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_CHARS = 1_500_000; // ~1 MB image as a data URL
const MAX_ITEMS = 2000;

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function snapshot(v: unknown): MediaSnapshot | null {
  const m = v as Partial<MediaSnapshot> | null;
  const id = num(m?.id);
  const title = str(m?.title);
  if (!m || !id || !title || (m.type !== 'ANIME' && m.type !== 'MANGA')) return null;
  const https = (u: unknown) => {
    const s = str(u, 1000);
    return s && s.startsWith('https://') ? s : null;
  };
  return {
    id,
    type: m.type,
    title,
    romaji: str(m.romaji),
    native: str(m.native),
    cover: https(m.cover) ?? '',
    banner: https(m.banner),
    color: str(m.color, 16),
    format: str(m.format, 16) as MediaSnapshot['format'],
    episodes: num(m.episodes),
    chapters: num(m.chapters),
    year: num(m.year),
    status: str(m.status, 24) as MediaSnapshot['status'],
  };
}

function avatar(v: unknown): string | null {
  const s = typeof v === 'string' ? v : '';
  return /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s) && s.length <= MAX_AVATAR_CHARS ? s : null;
}

export function cleanProfile(v: unknown): Profile {
  const p = (v ?? {}) as Partial<Profile>;
  return {
    id: str(p.id, 64) ?? crypto.randomUUID(),
    name: str(p.name, 40) ?? 'PlayzAnime viewer',
    avatar: avatar(p.avatar),
    tagline: str(p.tagline, 120),
    favorites: (Array.isArray(p.favorites) ? p.favorites : [])
      .map(snapshot)
      .filter((m): m is MediaSnapshot => m !== null)
      .slice(0, 24),
    createdAt: num(p.createdAt) ?? Date.now(),
  };
}

/** Checks a .playzanime file field by field; anything unexpected is dropped, never trusted. */
export function parseProfileFile(text: string): ProfileExport {
  if (text.length > MAX_FILE_BYTES) throw new Error('That file is too large to be a PlayzAnime profile.');
  let raw: Partial<ProfileExport>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t a PlayzAnime profile.');
  }
  if (raw?.format !== 'playzanime-profile') throw new Error('That file isn’t a PlayzAnime profile.');
  if (raw.version !== 1) throw new Error('That profile was made by a newer PlayzAnime. Update to import it.');
  if (raw.profile?.id && raw.profile.id === store().profile?.id) throw new Error('That’s your own profile.');

  const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(v) ? v : [])
      .slice(0, MAX_ITEMS)
      .map((x) => map((x ?? {}) as Record<string, unknown>))
      .filter((x): x is T => x !== null);

  const library = list<LibraryEntry>(raw.library, (e) => {
    const media = snapshot(e.media);
    const status = e.status as LibraryEntry['status'];
    if (!media || !['watching', 'planning', 'completed', 'paused', 'dropped'].includes(status)) return null;
    return { media, status, addedAt: num(e.addedAt) ?? 0, updatedAt: num(e.updatedAt) ?? 0 };
  });
  const history = list<HistoryEntry>(raw.history, (e) => {
    const media = snapshot(e.media);
    const episode = num(e.episode);
    if (!media || episode === null) return null;
    return {
      media,
      episode,
      episodeTitle: str(e.episodeTitle),
      thumbnail: null,
      position: num(e.position) ?? 0,
      duration: num(e.duration) ?? 0,
      audio: e.audio === 'dub' ? 'dub' : 'sub',
      updatedAt: num(e.updatedAt) ?? 0,
    };
  });
  const reading = list<ReadingEntry>(raw.reading, (e) => {
    const media = snapshot(e.media);
    if (!media) return null;
    return {
      media,
      chapterId: str(e.chapterId, 200) ?? '',
      chapterNumber: str(e.chapterNumber, 16),
      chapterTitle: str(e.chapterTitle),
      page: num(e.page) ?? 0,
      pages: num(e.pages) ?? 0,
      updatedAt: num(e.updatedAt) ?? 0,
    };
  });

  return { format: 'playzanime-profile', version: 1, exportedAt: num(raw.exportedAt) ?? Date.now(), profile: cleanProfile(raw.profile), library, history, reading };
}

// A profile file opened from Explorer (double-click, or "Open with") waits here until the page takes it.
let pending: string | null = null;

/** Reads a .playzanime path from a command line, if there is one, and holds its text for the page. */
export async function acceptProfileFromArgs(argv: string[]): Promise<boolean> {
  const file = argv.find((a) => a.toLowerCase().endsWith(`.${PROFILE_EXT}`));
  if (!file) return false;
  try {
    const { size } = await fs.promises.stat(file);
    if (size > MAX_FILE_BYTES) return false;
    pending = await fs.promises.readFile(file, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function takePendingProfile(): string | null {
  const text = pending;
  pending = null;
  return text;
}

export async function exportProfileFile(): Promise<string | null> {
  const data = store().exportProfile();
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const safeName = data.profile.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'profile';
  const result = await dialog.showSaveDialog(win, {
    title: 'Share your PlayzAnime profile',
    defaultPath: `${safeName}.${PROFILE_EXT}`,
    filters: [{ name: 'PlayzAnime profile', extensions: [PROFILE_EXT] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, JSON.stringify(data, null, 1));
  return result.filePath;
}

export async function pickProfileFile(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, {
    title: 'Import a PlayzAnime profile',
    filters: [{ name: 'PlayzAnime profile', extensions: [PROFILE_EXT, 'json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const { size } = await fs.promises.stat(result.filePaths[0]);
  if (size > MAX_FILE_BYTES) throw new Error('That file is too large to be a PlayzAnime profile.');
  return fs.promises.readFile(result.filePaths[0], 'utf8');
}
