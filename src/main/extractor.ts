import { BrowserWindow, session, type OnBeforeRequestListenerDetails, type Session } from 'electron';
import type { ResolvedStream, StreamVariant, SubtitleTrack, TimeRange } from '../shared/types';
import { TtlCache } from './cache';
import { CHROME_UA, getJson, getText } from './http';
import { logger } from './log';
import { registerRefererHosts } from './network';

const log = logger('extractor');
const cache = new TtlCache(100);

const RESOLVE_TIMEOUT = 25_000;
const GRACE_AFTER_PLAYLIST = 900;
const MAX_PARALLEL = 2;

type Capture = (details: OnBeforeRequestListenerDetails) => void;
const captures = new Map<number, Capture>();

let extractSession: Session | null = null;

/**
 * An isolated, in-memory session for the hidden windows that load embed pages.
 * Nothing it stores (cookies, cache) reaches the main window.
 */
function getSession(): Session {
  if (extractSession) return extractSession;
  const s = session.fromPartition('extract', { cache: false });
  s.setUserAgent(CHROME_UA);
  s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  s.webRequest.onBeforeRequest((details, cb) => {
    if (details.webContentsId != null) captures.get(details.webContentsId)?.(details);
    // Pictures and fonts are never needed to reach the playlist request.
    if (details.resourceType === 'image' || details.resourceType === 'font') {
      cb({ cancel: true });
      return;
    }
    cb({});
  });
  extractSession = s;
  return s;
}

// ── Concurrency gate ────────────────────────────────────────────────────────

let running = 0;
const waiting: (() => void)[] = [];

async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// ── Capture ─────────────────────────────────────────────────────────────────

interface Captured {
  playlists: string[];
  subtitles: string[];
  getSources: string | null;
}

function captureFromEmbed(embedUrl: string): Promise<Captured> {
  const origin = new URL(embedUrl).origin;
  const win = new BrowserWindow({
    show: false,
    width: 960,
    height: 540,
    webPreferences: {
      session: getSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      images: false,
    },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const found: Captured = { playlists: [], subtitles: [], getSources: null };
  const id = win.webContents.id;

  return new Promise<Captured>((resolve, reject) => {
    let settled = false;
    let graceTimer: NodeJS.Timeout | null = null;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (graceTimer) clearTimeout(graceTimer);
      captures.delete(id);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err);
      else resolve(found);
    };

    const timeout = setTimeout(() => {
      finish(found.playlists.length ? undefined : new Error('The player did not start a stream in time.'));
    }, RESOLVE_TIMEOUT);

    captures.set(id, (details) => {
      const u = details.url;
      if (u.includes('ping.gif')) return;
      if (/\.m3u8(\?|$)/i.test(u) && !found.playlists.includes(u)) {
        found.playlists.push(u);
        graceTimer ??= setTimeout(() => finish(), GRACE_AFTER_PLAYLIST);
      } else if (/getSources/i.test(u) && !found.getSources) {
        found.getSources = u;
      } else if (/\.(vtt|srt)(\?|$)/i.test(u) && !found.subtitles.includes(u)) {
        found.subtitles.push(u);
      }
    });

    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error(`Embed page failed to load (${desc || code}).`));
      else log.debug('subframe failed', url, desc);
    });
    win.webContents.on('render-process-gone', () => finish(new Error('Embed page crashed.')));

    win.loadURL(embedUrl, { httpReferrer: `${origin}/`, userAgent: CHROME_UA }).catch(() => {
      /* reported through did-fail-load */
    });
  });
}

// ── Playlist & metadata parsing ─────────────────────────────────────────────

function withToken(url: string, master: string): string {
  const token = /[?&]token=([^&]+)/.exec(master)?.[1];
  if (!token || url.includes('?')) return url;
  return `${url}?token=${token}`;
}

function qualityLabel(height: number, bandwidth: number): { label: string; height: number } {
  let h = height;
  if (!h) {
    const kbps = bandwidth / 1000;
    h = kbps >= 3500 ? 1080 : kbps >= 1500 ? 720 : kbps >= 800 ? 480 : 360;
  }
  const tiers = [2160, 1440, 1080, 720, 480, 360, 240];
  const tier = tiers.find((t) => h >= t * 0.9) ?? h;
  return { label: `${tier}p`, height: tier };
}

async function parseMaster(master: string, referer: string): Promise<StreamVariant[]> {
  const text = await getText(master, { headers: { Referer: referer }, timeoutMs: 12000 });
  if (!text.includes('#EXT-X-STREAM-INF')) {
    // Already a media playlist: a single quality.
    return [{ label: 'Auto', height: 0, bandwidth: 0, url: master }];
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const variants: StreamVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
    const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? 0);
    const q = qualityLabel(res ? Number(res[2]) : 0, bw);
    variants.push({ label: q.label, height: q.height, bandwidth: bw, url: withToken(new URL(uri, master).toString(), master) });
  }
  variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  // Drop duplicate tiers (same height, lower bitrate).
  return variants.filter((v, i) => i === 0 || v.label !== variants[i - 1].label);
}

/** Collect segment and key hosts so the header rules cover every request hls.js will make. */
async function segmentHosts(variantUrl: string, referer: string): Promise<string[]> {
  try {
    const text = await getText(variantUrl, { headers: { Referer: referer }, timeoutMs: 12000 });
    const urls: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const key = /URI="([^"]+)"/.exec(line)?.[1];
      if (key) urls.push(new URL(key, variantUrl).toString());
      else if (!line.startsWith('#')) urls.push(new URL(line, variantUrl).toString());
      if (urls.length > 12) break;
    }
    return urls;
  } catch {
    return [];
  }
}

const LANGS: Record<string, string> = {
  eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', ger: 'German', deu: 'German', de: 'German',
  ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ru: 'Russian',
  ara: 'Arabic', ar: 'Arabic', fra: 'French', fre: 'French', fr: 'French', jpn: 'Japanese', ja: 'Japanese',
  ind: 'Indonesian', id: 'Indonesian', tha: 'Thai', vie: 'Vietnamese', may: 'Malay', msa: 'Malay',
};

function labelFromUrl(url: string): string {
  const m = /\/([a-z]{2,3})(?:-\d+)?\.(?:vtt|srt)/i.exec(url.toLowerCase());
  return (m && LANGS[m[1]]) || 'English';
}

/** "Portuguese (- Portuguese(Brazil))" → "Portuguese (Brazil)" */
function tidyLabel(label: string): string {
  return label
    .replace(/\(\s*-\s*[^()]*\(([^)]+)\)\s*\)/, '($1)')
    .replace(/\s+-\s+\w+\s*\(([^)]+)\)$/, ' ($1)')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function uniqueLabels(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const counts = new Map<string, number>();
  return tracks.map((raw) => {
    const t = { ...raw, label: tidyLabel(raw.label) };
    const n = (counts.get(t.label) ?? 0) + 1;
    counts.set(t.label, n);
    return n === 1 ? t : { ...t, label: `${t.label} ${n}` };
  });
}

interface SourcesJson {
  tracks?: { file?: string; label?: string; kind?: string; default?: boolean }[];
  intro?: { start?: number; end?: number };
  outro?: { start?: number; end?: number };
}

function range(r?: { start?: number; end?: number }): TimeRange | null {
  if (!r || typeof r.start !== 'number' || typeof r.end !== 'number' || r.end <= r.start) return null;
  return { start: r.start, end: r.end };
}

async function readSources(url: string, embedUrl: string) {
  try {
    return await getJson<SourcesJson>(url, {
      headers: { Referer: embedUrl, 'X-Requested-With': 'XMLHttpRequest' },
      timeoutMs: 8000,
    });
  } catch (err) {
    log.debug('getSources failed', String(err));
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function resolveStream(embedUrl: string, force = false): Promise<ResolvedStream> {
  return cache.wrap(`stream:${embedUrl}`, 4 * 60_000, () =>
    gate(async () => {
      const started = Date.now();
      const origin = new URL(embedUrl).origin;
      const referer = `${origin}/`;
      const captured = await captureFromEmbed(embedUrl);

      // Prefer a master playlist over a media playlist when both were requested.
      const master =
        captured.playlists.find((u) => /master|playlist|index/i.test(u)) ?? captured.playlists[0];
      registerRefererHosts(captured.playlists, referer);

      const sources = captured.getSources ? await readSources(captured.getSources, embedUrl) : null;
      const variants = await parseMaster(master, referer).catch((err) => {
        log.warn('master parse failed', String(err));
        return [{ label: 'Auto', height: 0, bandwidth: 0, url: master } as StreamVariant];
      });

      const subtitles: SubtitleTrack[] = [];
      for (const t of sources?.tracks ?? []) {
        if (!t.file || (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles')) continue;
        const generic = !t.label || ['subtitles', 'default', 'cc', 'caption'].includes(t.label.toLowerCase());
        subtitles.push({ label: generic ? labelFromUrl(t.file) : t.label!.trim(), url: t.file, isDefault: !!t.default });
      }
      for (const u of captured.subtitles) {
        if (!subtitles.some((s) => s.url === u)) subtitles.push({ label: labelFromUrl(u), url: u });
      }

      const hostSamples = await segmentHosts(variants[0].url, referer);
      registerRefererHosts([...variants.map((v) => v.url), ...hostSamples, ...subtitles.map((s) => s.url)], referer);

      log.info(`resolved ${embedUrl} in ${Date.now() - started}ms (${variants.length} variants, ${subtitles.length} subs)`);
      return {
        embedUrl,
        master,
        host: new URL(master).host,
        variants,
        subtitles: uniqueLabels(subtitles),
        intro: range(sources?.intro),
        outro: range(sources?.outro),
        resolvedAt: Date.now(),
      };
    }),
  force);
}

export function clearStreamCache() {
  cache.clear();
}
