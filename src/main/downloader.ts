import { app, BrowserWindow, Notification, shell } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ChapterDownloadRequest,
  DownloadJob,
  DownloadRequest,
  EpisodeDownloadRequest,
  Media,
  MediaSnapshot,
  MediaType,
  QualityPref,
  StreamVariant,
} from '../shared/types';
import * as anilist from './anilist';
import { resolveStream } from './extractor';
import { ensureFfmpeg } from './ffmpeg';
import { getBuffer, getText, HttpError, retry } from './http';
import { logger } from './log';
import { chapterPages, refererFor } from './manga';
import { store, withTimeout } from './store';
import { comicInfo, writeZip } from './zip';

const log = logger('downloads');

// ── Resumable parts ─────────────────────────────────────────────────────────
// Every segment or page is saved as its own file while a job runs, so a job that
// fails, is interrupted, or outlives an app restart continues where it stopped.

const partDir = (jobId: string) => path.join(app.getPath('userData'), 'partial', jobId);
const partFile = (dir: string, i: number | 'init') => path.join(dir, `${i}.part`);

function existingParts(dir: string): Map<number, number> {
  const found = new Map<number, number>();
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d+)\.part$/.exec(name);
      if (m) found.set(Number(m[1]), fs.statSync(path.join(dir, name)).size);
    }
  } catch {
    /* nothing saved yet */
  }
  return found;
}

/** Written under a temp name and renamed, so a crash never leaves half a part that looks complete. */
async function savePart(file: string, data: Buffer) {
  await fs.promises.writeFile(`${file}.tmp`, data);
  await fs.promises.rename(`${file}.tmp`, file);
}

/** Parts only line up if the playlist is the same one; otherwise start that job clean. */
function prepareParts(dir: string, signature: string): Map<number, number> {
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(dir, 'meta.json');
  let same = false;
  try {
    same = JSON.parse(fs.readFileSync(metaFile, 'utf8')).signature === signature;
  } catch {
    /* first run */
  }
  if (!same) {
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
    fs.writeFileSync(metaFile, JSON.stringify({ signature }));
  }
  return existingParts(dir);
}

const dropParts = (jobId: string) => fs.rm(partDir(jobId), { recursive: true, force: true }, () => {});

/** How many downloads run at once: the setting, kept between 1 and 8. */
const maxActive = () => Math.min(8, Math.max(1, Math.round(store().settings.maxDownloads || 3)));
const SEGMENT_CONCURRENCY = 4;
const PAGE_CONCURRENCY = 4;
const READ_AHEAD = 24;
const ACTIVE: DownloadJob['state'][] = ['queued', 'resolving', 'downloading', 'muxing'];
const FINISHED: DownloadJob['state'][] = ['done', 'error', 'cancelled'];

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeName(s: string): string {
  return (
    s
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'Untitled'
  );
}

// Download folders may sit under Videos/Documents, where Windows (Defender folder protection,
// OneDrive) can hold a file call for seconds. Only async calls touch them, never the main thread.
const exists = (f: string) => fs.promises.access(f).then(() => true, () => false);

async function uniquePath(p: string): Promise<string> {
  if (!(await exists(p))) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 100; i++) {
    const candidate = path.join(dir, `${name} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, `${name} ${Date.now()}${ext}`);
}

const tmpMp4Of = (jobId: string) => path.join(os.tmpdir(), `playzanime-${jobId}.mp4`);

/** Subtitles the in-app player uses for a downloaded episode; kept with the app's data, not beside the video. */
export const appSubtitlePath = (jobId: string) => path.join(app.getPath('userData'), 'subtitles', `${jobId}.vtt`);

/** Rename when possible; across drives, copy and then delete the original. */
async function moveFile(from: string, to: string) {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  }
}

/** "Attack on Titan Season 3" → { show: "Attack on Titan", season: 3 }; also "2nd Season". */
export function splitSeason(title: string): { show: string; season: number | null } {
  const m = /[\s:\-–]*(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season)\b.*$/i.exec(title);
  if (!m || m.index === 0) return { show: title, season: null };
  return { show: title.slice(0, m.index).trim(), season: Number(m[1] ?? m[2]) };
}

/** MangaDex@Home mirrors sometimes lose a file; the main origin serves the same path. */
async function fetchPage(url: string, opts: Parameters<typeof getBuffer>[1]): Promise<Buffer> {
  try {
    return await getBuffer(url, opts);
  } catch (err) {
    const u = new URL(url);
    if (err instanceof HttpError && u.host.endsWith('mangadex.network') && (err.status === 404 || err.status >= 500)) {
      return getBuffer(`https://uploads.mangadex.org${u.pathname}`, opts);
    }
    throw err;
  }
}

function pickVariant(variants: StreamVariant[], pref: QualityPref): StreamVariant {
  if (pref === 'best') return variants[0];
  const cap = Number(pref);
  return variants.find((v) => v.height > 0 && v.height <= cap) ?? variants[variants.length - 1];
}

const ISO: Record<string, string> = {
  english: 'eng', spanish: 'spa', german: 'ger', italian: 'ita', portuguese: 'por', russian: 'rus',
  arabic: 'ara', french: 'fre', japanese: 'jpn', indonesian: 'ind', thai: 'tha', vietnamese: 'vie', malay: 'may',
};
const isoOf = (label?: string | null) => ISO[(label ?? '').toLowerCase().split(' ')[0]] ?? 'und';

function pad(n: string | number, width: number): string {
  const [whole, frac] = String(n).split('.');
  return whole.padStart(width, '0') + (frac ? `.${frac}` : '');
}

export function episodeLabel(episode: number, title?: string | null, isMovie = false): string {
  if (isMovie) return 'Full movie';
  const t = title && !/^episode\s*\d+$/i.test(title) ? ` · ${title}` : '';
  return `E${pad(episode, 2)}${t}`;
}

export function chapterLabel(number: string | null, title?: string | null): string {
  const n = number ? `Ch. ${number}` : 'Oneshot';
  return title ? `${n} · ${title}` : n;
}

/** Some CDNs prefix MPEG-TS segments with junk bytes (often a fake image header). Skip to the first sync byte run. */
function alignTs(buf: Buffer): Buffer {
  if (buf.length < 564 || (buf[0] === 0x47 && buf[188] === 0x47)) return buf;
  // Fake headers (a whole PNG or WEBP) can be tens of KB; jump between sync-byte candidates.
  const limit = Math.min(buf.length - 376, 512 * 1024);
  for (let i = buf.indexOf(0x47); i !== -1 && i < limit; i = buf.indexOf(0x47, i + 1)) {
    if (buf[i + 188] === 0x47 && buf[i + 376] === 0x47) return buf.subarray(i);
  }
  return buf;
}

/**
 * Pages are stored exactly as the source sent them, never decoded or re-encoded, so
 * unusual formats (AVIF, odd JPEG subsampling) can't fail a download. The extension
 * comes from the file's own signature, because URLs often lie.
 */
function imageExt(buf: Buffer, url: string): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp' && /^avi[fs]$/.test(buf.subarray(8, 12).toString('ascii'))) return 'avif';
  const fromUrl = /\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  return fromUrl === 'jpeg' ? 'jpg' : (fromUrl ?? 'jpg');
}

interface KeyInfo {
  method: string;
  uri: string | null;
  iv: Buffer | null;
}

interface MediaPlaylist {
  segments: { url: string; key: KeyInfo | null; seq: number }[];
  initSegment: string | null;
}

function parseMediaPlaylist(text: string, base: string): MediaPlaylist {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let seq = 0;
  let key: KeyInfo | null = null;
  let initSegment: string | null = null;
  const segments: MediaPlaylist['segments'] = [];
  const attr = (line: string, name: string): string | null => {
    const m = new RegExp(`(?:^|[:,])${name}=(?:"([^"]*)"|([^,]*))`).exec(line);
    return m ? (m[1] ?? m[2] ?? null) : null;
  };
  const token = /[?&]token=([^&]+)/.exec(base)?.[1];
  const withToken = (u: string) => (token && !u.includes('?') ? `${u}?token=${token}` : u);

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const method = attr(line, 'METHOD') ?? 'NONE';
      const uri = attr(line, 'URI');
      const ivHex = attr(line, 'IV');
      key =
        method === 'NONE'
          ? null
          : {
              method,
              uri: uri ? new URL(uri, base).toString() : null,
              iv: ivHex ? Buffer.from(ivHex.replace(/^0x/i, '').padStart(32, '0'), 'hex') : null,
            };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attr(line, 'URI');
      if (uri) initSegment = withToken(new URL(uri, base).toString());
    } else if (!line.startsWith('#')) {
      segments.push({ url: withToken(new URL(line, base).toString()), key, seq });
      seq++;
    }
  }
  return { segments, initSegment };
}

function runFfmpeg(bin: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-2000)));
    const onAbort = () => proc.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });
    proc.on('error', reject);
    proc.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) reject(new Error('cancelled'));
      else if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

/**
 * Runs `work` over `count` items with bounded parallelism, but hands results to
 * `onResult` strictly in index order. At most READ_AHEAD results wait in memory.
 */
function orderedPool<T>(
  count: number,
  limit: { value: number },
  work: (i: number, signal: AbortSignal) => Promise<T>,
  onResult: (value: T, i: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (count === 0) return resolve();
    const ready = new Map<number, T>();
    let next = 0;
    let launched = 0;
    let inFlight = 0;
    let failed = false;
    // One failure stops every other request of this job instead of leaving them retrying.
    const stop = new AbortController();
    const poolSignal = AbortSignal.any([signal, stop.signal]);

    const fail = (err: unknown) => {
      if (failed) return;
      failed = true;
      stop.abort(err);
      reject(err);
    };
    const drain = () => {
      try {
        while (ready.has(next)) {
          const v = ready.get(next)!;
          ready.delete(next);
          onResult(v, next);
          next++;
        }
      } catch (err) {
        return fail(err);
      }
      if (next === count) resolve();
    };
    const launch = () => {
      while (!failed && inFlight < limit.value && launched < count && launched < next + READ_AHEAD) {
        const i = launched++;
        inFlight++;
        work(i, poolSignal)
          .then((v) => {
            inFlight--;
            if (failed) return;
            ready.set(i, v);
            drain();
            launch();
          })
          .catch(fail);
      }
    };
    signal.addEventListener('abort', () => fail(new Error('cancelled')), { once: true });
    launch();
  });
}

// ── Queue ───────────────────────────────────────────────────────────────────

type ProgressListener = (fraction: number | null) => void;

/** The details a download keeps about its series, from an AniList result. */
function snapshotOf(m: Media, type: MediaType): MediaSnapshot {
  return {
    id: m.id,
    type,
    title: m.title.english || m.title.romaji || m.title.native || 'Untitled',
    romaji: m.title.romaji ?? null,
    native: m.title.native ?? null,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || '',
    banner: m.bannerImage ?? null,
    color: m.coverImage?.color ?? null,
    format: m.format ?? null,
    episodes: m.episodes ?? null,
    chapters: m.chapters ?? null,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    status: m.status ?? null,
    country: m.countryOfOrigin ?? null,
  };
}

class Downloader {
  private jobs: DownloadJob[] = [];
  private controllers = new Map<string, AbortController>();
  private emitTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  /** Running jobs being stopped on purpose: paused keeps their parts, cancelled removes them. */
  private stopping = new Map<string, 'pause' | 'cancel'>();
  private progressListener: ProgressListener | null = null;

  constructor() {
    this.jobs = store()
      .downloadRecords()
      .map((j) =>
        // Unfinished jobs come back paused, keeping what they saved: Resume (or Resume all)
        // carries on. Nothing starts downloading by itself when the app opens.
        FINISHED.includes(j.state)
          ? j
          : {
              ...j,
              state: 'paused' as const,
              speed: 0,
              stage: null,
              // The saved record lags behind the disk; count what actually made it.
              partsDone: existingParts(partDir(j.id)).size || j.partsDone,
            },
      );
  }

  /** Lets the window show overall progress on its taskbar button. */
  onProgress(listener: ProgressListener) {
    this.progressListener = listener;
  }

  list(): DownloadJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  hasActive(): boolean {
    return this.jobs.some((j) => ACTIVE.includes(j.state));
  }

  activeSummary(): string {
    const active = this.jobs.filter((j) => ACTIVE.includes(j.state));
    return active.length ? active.map((j) => `${j.media.title} ${j.label} [${j.state}${j.stage ? `: ${j.stage}` : ''} ${j.partsDone}/${j.partsTotal}]`).join('; ') : 'idle';
  }

  private find(id: string) {
    return this.jobs.find((j) => j.id === id);
  }

  private emit(immediate = false) {
    const send = () => {
      this.emitTimer = null;
      const jobs = this.list();
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('downloads:update', jobs);
      }
      const active = this.jobs.filter((j) => ACTIVE.includes(j.state));
      this.progressListener?.(active.length ? active.reduce((n, j) => n + j.progress, 0) / active.length : null);
    };
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      send();
    } else if (!this.emitTimer) {
      // Big queues (thousands of chapters) are sent less often so the window stays responsive.
      this.emitTimer = setTimeout(send, this.jobs.length > 300 ? 700 : 250);
    }
  }

  /**
   * Unfinished jobs are saved too, so they can be resumed after a restart. Saves are batched:
   * with thousands of jobs, writing the list on every finished chapter would stall the app.
   */
  private persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.flush(), 600);
  }

  /** Writes the list now (also used when the app quits). */
  flush() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    store().saveDownloadRecords(this.jobs.map((j) => ({ ...j })));
  }

  private update(job: DownloadJob, patch: Partial<DownloadJob>, immediate = false) {
    Object.assign(job, patch);
    if (patch.state) this.persist();
    this.emit(immediate || Boolean(patch.state));
  }

  private isDuplicate(req: DownloadRequest) {
    return this.jobs.find((j) => {
      if (!(ACTIVE.includes(j.state) || j.state === 'paused') || j.media.id !== req.media.id || j.kind !== req.kind) return false;
      return req.kind === 'episode' ? j.episode === req.episode && j.audio === req.audio : j.chapter?.id === req.chapter.id;
    });
  }

  private create(req: DownloadRequest): DownloadJob {
    const base = {
      id: crypto.randomUUID(),
      media: req.media,
      state: 'queued' as const,
      progress: 0,
      bytes: 0,
      speed: 0,
      partsDone: 0,
      partsTotal: 0,
      createdAt: Date.now(),
    };
    if (req.kind === 'episode') {
      return {
        ...base,
        kind: 'episode',
        label: episodeLabel(req.episode, req.episodeTitle, req.media.format === 'MOVIE'),
        episode: req.episode,
        audio: req.audio,
        quality: req.quality,
        embedUrl: req.embedUrl,
        subtitleLabel: req.subtitleLabel ?? null,
      };
    }
    return { ...base, kind: 'chapter', label: chapterLabel(req.chapter.number, req.chapter.title), chapter: req.chapter };
  }

  start(req: DownloadRequest): DownloadJob {
    const dup = this.isDuplicate(req);
    if (dup) return { ...dup };
    const job = this.create(req);
    this.jobs.unshift(job);
    this.emit(true);
    this.pump();
    return { ...job };
  }

  startMany(reqs: DownloadRequest[]): number {
    let added = 0;
    // The list shows newest first and the pump takes the oldest first, so the batch runs in order.
    for (const req of reqs) {
      if (this.isDuplicate(req)) continue;
      this.jobs.unshift(this.create(req));
      added++;
    }
    this.emit(true);
    this.pump();
    return added;
  }

  /** Cancelling removes the download and whatever it had saved. Finished downloads aren't touched. */
  cancel(id: string) {
    this.cancelMany([id]);
  }

  /** Pauses downloads, keeping what they've saved. No ids means every unfinished download. */
  pauseMany(ids?: string[]) {
    const pick = ids ? new Set(ids) : null;
    for (const job of this.jobs) {
      if (pick && !pick.has(job.id)) continue;
      if (job.state === 'queued') Object.assign(job, { state: 'paused', speed: 0, stage: null });
      else if (this.controllers.has(job.id)) {
        this.stopping.set(job.id, 'pause');
        this.controllers.get(job.id)?.abort();
      }
    }
    this.persist();
    this.emit(true);
  }

  /** Resumes paused (and failed) downloads. No ids means all of them. */
  resumeMany(ids?: string[]) {
    const pick = ids ? new Set(ids) : null;
    for (const job of this.jobs) {
      if (pick && !pick.has(job.id)) continue;
      if (job.state === 'paused' || job.state === 'error' || job.state === 'cancelled') {
        // Progress is kept: the run recounts the saved parts and continues from there.
        Object.assign(job, { state: 'queued', error: null, stage: null, speed: 0, finishedAt: null });
      }
    }
    this.persist();
    this.emit(true);
    this.pump();
  }

  /** Cancels and deletes downloads that haven't finished. No ids means all of them. */
  cancelMany(ids?: string[]) {
    const pick = ids ? new Set(ids) : null;
    const drop = new Set<string>();
    for (const job of this.jobs) {
      if (job.state === 'done' || (pick && !pick.has(job.id))) continue;
      if (this.controllers.has(job.id)) {
        // Running: stop it; the run removes it once it has let go of its files.
        this.stopping.set(job.id, 'cancel');
        this.controllers.get(job.id)?.abort();
      } else {
        drop.add(job.id);
        dropParts(job.id);
      }
    }
    this.jobs = this.jobs.filter((j) => !drop.has(j.id));
    this.persist();
    this.emit(true);
  }

  pause(id: string) {
    this.pauseMany([id]);
  }

  retry(id: string) {
    this.resumeMany([id]);
  }

  remove(id: string, deleteFile = false) {
    const job = this.find(id);
    if (job && this.controllers.has(id)) {
      this.stopping.set(id, 'cancel');
      this.controllers.get(id)?.abort();
    }
    if (deleteFile && job?.outputFile) {
      for (const f of [job.outputFile, job.subtitleFile]) if (f) fs.rm(f, { force: true }, () => {});
    }
    dropParts(id);
    fs.rm(appSubtitlePath(id), { force: true }, () => {});
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.persist();
    this.emit(true);
  }

  /** Clears failed and cancelled entries. Finished ones stay: they are the offline library. */
  clearFinished() {
    this.jobs = this.jobs.filter((j) => !FINISHED.includes(j.state) || j.state === 'done');
    this.persist();
    this.emit(true);
  }

  /**
   * Finds episodes and chapters in the download folders that aren't in the list (after the
   * list was lost, a reinstall, or files copied in from another PC) and adds them back as
   * finished downloads. Returns how many were added.
   */
  async rescan(): Promise<number> {
    const known = new Set(this.jobs.map((j) => j.outputFile?.toLowerCase()).filter(Boolean));
    const { animeDir, mangaDir } = store().settings;
    const list = async (dir: string, depth: number): Promise<string[]> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      const out: string[] = [];
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth > 0) out.push(...(await list(full, depth - 1)));
        else if (e.isFile()) out.push(full);
      }
      return out;
    };
    // Series found on disk get a stable id of their own (negative, so it never clashes with AniList's).
    const idOf = (title: string) => -(parseInt(crypto.createHash('sha1').update(title.toLowerCase()).digest('hex').slice(0, 8), 16) % 1_000_000_000) - 1;
    const found: DownloadJob[] = [];
    const add = async (file: string, make: (stat: fs.Stats) => Omit<DownloadJob, 'id' | 'state' | 'progress' | 'speed' | 'partsDone' | 'bytes' | 'createdAt' | 'finishedAt' | 'outputFile'>) => {
      if (known.has(file.toLowerCase())) return;
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) return;
      found.push({ ...make(stat), id: crypto.randomUUID(), state: 'done', progress: 1, speed: 0, partsDone: 0, bytes: stat.size, createdAt: stat.mtimeMs, finishedAt: stat.mtimeMs, outputFile: file });
    };

    // PlayzAnime\<Show>\[Season N\]<Show>_E05_720p[_dub].mp4
    for (const file of await list(animeDir, 2)) {
      if (!/\.mp4$/i.test(file)) continue;
      const rel = path.relative(animeDir, file).split(path.sep);
      const show = rel.length > 1 ? rel[0] : path.basename(file).replace(/_.*$/, '');
      const ep = /_E(\d+)/i.exec(path.basename(file));
      const res = /_(\d{3,4}p)/i.exec(path.basename(file));
      const season = rel.length > 2 ? /Season (\d+)/i.exec(rel[1]) : null;
      const title = season ? `${show} Season ${season[1]}` : show;
      const base = file.replace(/\.mp4$/i, '');
      const vtt = (await fs.promises.readdir(path.dirname(file)).catch(() => [] as string[])).find((f) => f.startsWith(path.basename(base) + '.') && f.endsWith('.vtt'));
      await add(file, () => ({
        kind: 'episode',
        media: { id: idOf(title), type: 'ANIME', title, cover: '' },
        label: ep ? episodeLabel(Number(ep[1])) : path.basename(base),
        episode: ep ? Number(ep[1]) : 1,
        audio: /_dub\b/i.test(file) ? 'dub' : 'sub',
        resolution: res ? res[1] : null,
        subtitleFile: vtt ? path.join(path.dirname(file), vtt) : null,
        partsTotal: 0,
      }));
    }

    // PlayzManga\<Series>\<Series>_Ch012.cbz
    for (const file of await list(mangaDir, 1)) {
      if (!/\.cbz$/i.test(file)) continue;
      const rel = path.relative(mangaDir, file).split(path.sep);
      const series = rel.length > 1 ? rel[0] : path.basename(file).replace(/_Ch.*$/i, '');
      const ch = /_Ch(\d+(?:\.\d+)?)/i.exec(path.basename(file));
      const number = ch ? String(Number(ch[1])) : null;
      await add(file, () => ({
        kind: 'chapter',
        media: { id: idOf(series), type: 'MANGA', title: series, cover: '' },
        label: chapterLabel(number),
        chapter: { id: `file:${file}`, provider: 'mangadex', number, title: null, volume: null, group: null, pages: null, publishedAt: null, externalUrl: null },
        partsTotal: 0,
      }));
    }

    if (found.length) {
      await this.identify(found);
      this.jobs.push(...found.sort((a, b) => b.createdAt - a.createdAt));
      this.persist();
      this.emit(true);
      log.info(`rescan found ${found.length} download(s) on disk`);
    }
    return found.length;
  }

  /**
   * Series found on disk only know their folder name. Give them their real details (cover, id,
   * manga or manhwa), first from series already in the list, else from an AniList search.
   */
  private async identify(found: DownloadJob[]) {
    const norm = (t: string) => safeName(t).toLowerCase();
    const known = new Map<string, MediaSnapshot>();
    for (const j of this.jobs) if (j.media.id > 0) known.set(`${j.kind}:${norm(j.media.title)}`, j.media);
    const bySeries = new Map<string, DownloadJob[]>();
    for (const j of found) {
      const key = `${j.kind}:${norm(j.media.title)}`;
      bySeries.set(key, [...(bySeries.get(key) ?? []), j]);
    }
    for (const [key, jobs] of bySeries) {
      let media = known.get(key);
      if (!media) {
        const type: MediaType = jobs[0].kind === 'episode' ? 'ANIME' : 'MANGA';
        try {
          const hit = (await anilist.browse({ search: jobs[0].media.title, type, page: 1 })).items[0];
          if (hit) media = snapshotOf(hit, type);
        } catch {
          /* offline: keep the folder name */
        }
      }
      if (media) for (const j of jobs) j.media = media;
    }
  }

  /** Finished downloads whose file was moved or deleted outside the app. */
  async missingFiles(): Promise<string[]> {
    const done = this.jobs.filter((j) => j.state === 'done' && j.outputFile);
    const checks = await Promise.all(done.map((j) => withTimeout(exists(j.outputFile!), 5000, 'slow disk').catch(() => true)));
    return done.filter((_, i) => !checks[i]).map((j) => j.id);
  }

  async open(id: string): Promise<boolean> {
    const f = this.find(id)?.outputFile;
    if (!f || !(await exists(f))) return false;
    return (await shell.openPath(f)) === '';
  }

  async reveal(id: string): Promise<boolean> {
    const f = this.find(id)?.outputFile;
    if (!f || !(await exists(f))) return false;
    shell.showItemInFolder(f);
    return true;
  }

  private pump() {
    const running = this.jobs.filter((j) => ['resolving', 'downloading', 'muxing'].includes(j.state)).length;
    let slots = maxActive() - running;
    for (const job of [...this.jobs].reverse()) {
      if (slots <= 0) break;
      if (job.state !== 'queued') continue;
      slots--;
      void this.run(job);
    }
  }

  private async run(job: DownloadJob) {
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    try {
      if (job.kind === 'episode') await this.runEpisode(job, ctrl.signal);
      else await this.runChapter(job, ctrl.signal);
      this.update(job, { state: 'done', progress: 1, speed: 0, stage: null, finishedAt: Date.now() }, true);
      dropParts(job.id);
      this.notify(job);
      log.info(`finished ${job.outputFile}`);
    } catch (err) {
      const stop = ctrl.signal.aborted ? (this.stopping.get(job.id) ?? 'cancel') : null;
      if (stop === 'cancel') {
        // Cancelled: the download and its saved parts go away.
        dropParts(job.id);
        this.jobs = this.jobs.filter((j) => j.id !== job.id);
        this.persist();
        this.emit(true);
      } else if (stop === 'pause') {
        // Paused: parts stay, so Resume carries on from here.
        this.update(job, { state: 'paused', speed: 0, stage: null }, true);
      } else {
        // Any other failure keeps parts for Resume.
        this.update(job, { state: 'error', speed: 0, stage: null, error: err instanceof Error ? err.message : String(err), finishedAt: Date.now() }, true);
        log.error(`job ${job.id} failed`, err);
      }
    } finally {
      this.controllers.delete(job.id);
      this.stopping.delete(job.id);
      this.pump();
    }
  }

  private notify(job: DownloadJob) {
    if (!store().settings.notifyDownloads || !Notification.isSupported()) return;
    // One notice per batch: stay quiet while more of the queue is still going.
    if (this.jobs.some((j) => j.id !== job.id && ACTIVE.includes(j.state))) return;
    const n = new Notification({ title: 'Download finished', body: `${job.media.title} — ${job.label}`, silent: true });
    n.on('click', () => {
      if (job.outputFile) shell.showItemInFolder(job.outputFile);
    });
    n.show();
  }

  // ── Episodes ──

  private async runEpisode(job: DownloadJob, signal: AbortSignal) {
    const req = job as DownloadJob & Required<Pick<EpisodeDownloadRequest, 'embedUrl' | 'episode' | 'audio' | 'quality'>>;
    const tmpVideo = path.join(os.tmpdir(), `playzanime-${job.id}.ts`);
    const tmpSubs = path.join(os.tmpdir(), `playzanime-${job.id}.vtt`);
    try {
      this.update(job, { state: 'resolving', stage: 'Finding the stream' });
      const stream = await resolveStream(req.embedUrl);
      if (signal.aborted) throw new Error('cancelled');
      const referer = `${new URL(req.embedUrl).origin}/`;
      const variant = pickVariant(stream.variants, req.quality);

      const playlistText = await retry(() => getText(variant.url, { headers: { Referer: referer }, signal }), 3, signal);
      const playlist = parseMediaPlaylist(playlistText, variant.url);
      if (!playlist.segments.length) throw new Error('The stream playlist has no segments.');

      this.update(job, { state: 'downloading', stage: null, partsTotal: playlist.segments.length, resolution: variant.label });
      await this.fetchSegments(job, playlist, referer, tmpVideo, signal);

      // Subtitles: the requested track, else the preferred language for subbed audio.
      const want = job.subtitleLabel === 'none' ? null : (job.subtitleLabel ?? (req.audio === 'sub' ? store().settings.subtitleLanguage : null));
      const track = want
        ? (stream.subtitles.find((s) => s.label === want) ??
          stream.subtitles.find((s) => s.label.toLowerCase().startsWith(want.toLowerCase())) ??
          (req.audio === 'sub' ? stream.subtitles.find((s) => s.isDefault) : undefined))
        : undefined;
      let subsPath: string | null = null;
      if (track) {
        try {
          fs.writeFileSync(tmpSubs, await getBuffer(track.url, { headers: { Referer: referer }, signal }));
          subsPath = tmpSubs;
        } catch (err) {
          log.warn('subtitle download failed', String(err));
        }
      }

      // PlayzAnime\<Anime>\Season N\<Anime>_E05_480p.mp4 (no season folder when the title has none).
      const { show, season } = splitSeason(job.media.title);
      const series = safeName(show);
      const root = await store().resolveDir('anime');
      const dir = season ? path.join(root, series, `Season ${season}`) : path.join(root, series);
      await withTimeout(fs.promises.mkdir(dir, { recursive: true }), 15_000, `Windows didn't let PlayzAnime create ${dir}`);
      const isMovie = job.media.format === 'MOVIE';
      const quality = variant.label === 'Auto' ? 'HD' : variant.label;
      const dubTag = req.audio === 'dub' ? '_DUB' : '';
      const base = isMovie ? `${series}_${quality}${dubTag}` : `${series}_E${pad(req.episode, 2)}_${quality}${dubTag}`;

      this.update(job, { state: 'muxing', progress: 0.97, stage: 'Preparing ffmpeg' });
      let ffmpeg: string | null = null;
      try {
        ffmpeg = await ensureFfmpeg((got, total) => {
          this.update(job, { stage: `Fetching ffmpeg, one time only (${Math.round(got / 1048576)} of ${Math.round(total / 1048576) || '?'} MB)` });
        }, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        log.warn('ffmpeg unavailable, keeping MPEG-TS', String(err));
      }

      if (!ffmpeg) {
        // Without ffmpeg the episode still plays: MPEG-TS opens in VLC, MPV and Windows Media Player.
        const output = await uniquePath(path.join(dir, `${base}.ts`));
        await fs.promises.copyFile(tmpVideo, output);
        let subtitleFile: string | null = null;
        if (subsPath) {
          subtitleFile = output.replace(/\.ts$/, `.${isoOf(track?.label)}.vtt`);
          await fs.promises.copyFile(subsPath, subtitleFile);
        }
        this.update(job, { outputFile: output, subtitleFile });
        return;
      }

      this.update(job, { stage: 'Packing into MP4' });
      const output = await uniquePath(path.join(dir, `${base}.mp4`));
      // ffmpeg writes to the temp folder and the app moves the result, so ffmpeg never
      // needs access to guarded folders (Controlled folder access) itself.
      const tmpMp4 = tmpMp4Of(job.id);
      const isTs = !playlist.initSegment;
      const args = (withSubs: boolean) => [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', tmpVideo,
        ...(withSubs && subsPath ? ['-i', subsPath] : []),
        '-map', '0:v?', '-map', '0:a?',
        ...(withSubs && subsPath
          ? ['-map', '1:0', '-c:s', 'mov_text', '-metadata:s:s:0', `language=${isoOf(track?.label)}`, '-metadata:s:s:0', `title=${track?.label ?? 'Subtitles'}`]
          : []),
        '-c:v', 'copy', '-c:a', 'copy',
        ...(isTs ? ['-bsf:a', 'aac_adtstoasc'] : []),
        '-movflags', '+faststart',
        '-metadata', `title=${job.media.title} ${job.label}`,
        tmpMp4,
      ];

      let subtitleFile: string | null = null;
      try {
        await runFfmpeg(ffmpeg, args(true), signal);
      } catch (err) {
        if (!subsPath || signal.aborted) throw err;
        // A malformed subtitle file should not cost the whole episode: mux video only, keep subs beside it.
        log.warn('mux with subtitles failed, retrying without', String(err));
        await runFfmpeg(ffmpeg, args(false), signal);
        subtitleFile = output.replace(/\.mp4$/, `.${isoOf(track?.label)}.vtt`);
        await fs.promises.copyFile(subsPath, subtitleFile);
      }
      this.update(job, { stage: 'Saving to your folder' });
      await withTimeout(moveFile(tmpMp4, output), 10 * 60_000, 'Saving the episode to its folder took too long.');
      // The in-app player can't show subtitles packed inside an MP4, so it keeps its own copy.
      if (subsPath) await fs.promises.mkdir(path.dirname(appSubtitlePath(job.id)), { recursive: true }).then(() => fs.promises.copyFile(subsPath, appSubtitlePath(job.id))).catch(() => {});
      this.update(job, { outputFile: output, subtitleFile });
    } finally {
      for (const f of [tmpVideo, tmpSubs, tmpMp4Of(job.id)]) fs.rm(f, { force: true }, () => {});
    }
  }

  /**
   * Fetches every missing segment into the job's parts folder (in parallel, backing off
   * when the host rate-limits), then joins the parts in order into one stream file.
   */
  private async fetchSegments(job: DownloadJob, playlist: MediaPlaylist, referer: string, target: string, signal: AbortSignal) {
    const headers = { Referer: referer };
    const keys = new Map<string, Promise<Buffer>>();
    const getKey = (uri: string, s: AbortSignal) => {
      if (!keys.has(uri)) keys.set(uri, retry(() => getBuffer(uri, { headers, signal: s }), 5, s));
      return keys.get(uri)!;
    };

    const total = playlist.segments.length;
    const dir = partDir(job.id);
    const have = prepareParts(dir, `${job.resolution}|${total}|${Boolean(playlist.initSegment)}`);
    const todo = playlist.segments.map((_, i) => i).filter((i) => !have.has(i));
    let done = have.size;
    let bytes = [...have.values()].reduce((a, b) => a + b, 0);
    if (done) log.info(`resuming ${job.id}: ${done}/${total} segments already saved`);
    this.update(job, { partsDone: done, bytes, progress: (done / total) * 0.96 });

    // Start gently and back off further whenever the host says "too many requests".
    const limit = { value: SEGMENT_CONCURRENCY };
    const slowDown = () => {
      if (limit.value > 1) limit.value -= 1;
    };

    if (playlist.initSegment && !fs.existsSync(partFile(dir, 'init'))) {
      await savePart(partFile(dir, 'init'), await retry(() => getBuffer(playlist.initSegment!, { headers, signal }), 5, signal));
    }

    let lastTick = Date.now();
    let lastBytes = bytes;
    let speed = 0;

    await orderedPool(
      todo.length,
      limit,
      async (k, poolSignal) => {
        const i = todo[k];
        const seg = playlist.segments[i];
        let data = await retry(() => getBuffer(seg.url, { headers, signal: poolSignal, timeoutMs: 30000 }), 9, poolSignal, slowDown);
        if (seg.key?.method === 'AES-128' && seg.key.uri) {
          const key = await getKey(seg.key.uri, poolSignal);
          let iv = seg.key.iv;
          if (!iv) {
            // Without an explicit IV, HLS uses the media sequence number.
            iv = Buffer.alloc(16);
            iv.writeBigUInt64BE(BigInt(seg.seq), 8);
          }
          const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
          data = Buffer.concat([decipher.update(data), decipher.final()]);
        } else if (seg.key && seg.key.method !== 'AES-128') {
          throw new Error(`Unsupported stream encryption (${seg.key.method}).`);
        }
        const clean = playlist.initSegment ? data : alignTs(data);
        await savePart(partFile(dir, i), clean);
        return clean.length;
      },
      (size) => {
        done++;
        bytes += size;
        const now = Date.now();
        if (now - lastTick >= 500 || done === total) {
          const inst = ((bytes - lastBytes) * 1000) / Math.max(1, now - lastTick);
          speed = speed ? speed * 0.7 + inst * 0.3 : inst;
          lastTick = now;
          lastBytes = bytes;
          this.update(job, { partsDone: done, bytes, speed, progress: (done / total) * 0.96 });
        }
      },
      signal,
    );

    // Join the parts in order, respecting the disk's pace.
    log.info(`${job.id}: all ${total} segments saved, joining`);
    this.update(job, { stage: 'Joining segments' });
    const out = fs.createWriteStream(target);
    try {
      const order = [...(playlist.initSegment ? ['init' as const] : []), ...playlist.segments.map((_, i) => i)];
      for (const i of order) {
        if (signal.aborted) throw new Error('cancelled');
        const data = await fs.promises.readFile(partFile(dir, i));
        if (!out.write(data)) await once(out, 'drain');
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      throw err;
    }
  }

  // ── Chapters ──

  private async runChapter(job: DownloadJob, signal: AbortSignal) {
    const chapter = (job as DownloadJob & Required<Pick<ChapterDownloadRequest, 'chapter'>>).chapter;
    if (chapter.externalUrl) throw new Error('This chapter is only available on the publisher’s site.');

    this.update(job, { state: 'resolving', stage: 'Listing pages' });
    const pages = await chapterPages(chapter);
    if (!pages.length) throw new Error('The source returned no pages for this chapter.');

    const dir = partDir(job.id);
    const have = prepareParts(dir, `${chapter.id}|${pages.length}`);
    const todo = pages.map((_, i) => i).filter((i) => !have.has(i));
    let done = have.size;
    let bytes = [...have.values()].reduce((a, b) => a + b, 0);
    const started = Date.now();
    this.update(job, { state: 'downloading', stage: null, partsTotal: pages.length, partsDone: done, bytes, progress: (done / pages.length) * 0.98 });

    const referer = refererFor(chapter.provider);
    const limit = { value: PAGE_CONCURRENCY };
    await orderedPool(
      todo.length,
      limit,
      async (k, poolSignal) => {
        const i = todo[k];
        const data = await retry(
          () => fetchPage(pages[i].url, { headers: referer ? { Referer: referer } : {}, signal: poolSignal, timeoutMs: 30000 }),
          7,
          poolSignal,
          () => {
            if (limit.value > 1) limit.value -= 1;
          },
        );
        await savePart(partFile(dir, i), data);
        return data.length;
      },
      (size) => {
        done++;
        bytes += size;
        const elapsed = (Date.now() - started) / 1000;
        this.update(job, { partsDone: done, bytes, speed: elapsed > 0.5 ? bytes / elapsed : 0, progress: (done / pages.length) * 0.98 });
      },
      signal,
    );

    this.update(job, { state: 'muxing', stage: 'Packing CBZ' });
    const digits = Math.max(3, String(pages.length).length);
    const entries: { name: string; data: Buffer }[] = [];
    for (let i = 0; i < pages.length; i++) {
      const data = await fs.promises.readFile(partFile(dir, i));
      entries.push({ name: `${String(i + 1).padStart(digits, '0')}.${imageExt(data, pages[i].url)}`, data });
    }

    // PlayzManga\<Series>\<Series>_Ch012.cbz
    const series = safeName(job.media.title);
    const root = await store().resolveDir('manga');
    const outDir = path.join(root, series);
    await withTimeout(fs.promises.mkdir(outDir, { recursive: true }), 15_000, `Windows didn't let PlayzAnime create ${outDir}`);
    const num = chapter.number ? pad(chapter.number, 3) : 'Oneshot';
    const output = await uniquePath(path.join(outDir, `${series}_Ch${num}.cbz`));
    await withTimeout(
      writeZip(output, [...entries, comicInfo(job.media.title, chapter.number, chapter.title, entries.length)]),
      120_000,
      `Saving the chapter to ${outDir} took too long. Pick another folder on the Downloads page.`,
    );
    this.update(job, { outputFile: output });
  }
}

let instance: Downloader | null = null;
export function downloader(): Downloader {
  instance ??= new Downloader();
  return instance;
}
