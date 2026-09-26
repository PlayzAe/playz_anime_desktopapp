import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { logger } from './log';

const log = logger('ffmpeg');

/*
 * ffmpeg is 80 MB, more than the rest of the app combined, and only episode
 * downloads need it. Instead of shipping it in the installer we fetch the same
 * build ffmpeg-static uses the first time someone downloads an episode, verify
 * it, and keep it in the app's data folder.
 */
const RELEASE = 'b6.1.1';
const URL_BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;
const EXPECTED_SHA256: Record<string, string> = {
  'win32-x64': '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
};

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

function candidates(): string[] {
  return [
    process.env.FFMPEG_BIN ?? '',
    // Development: the copy npm installed.
    path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', exe),
    path.join(app.getPath('userData'), 'bin', exe),
  ].filter(Boolean);
}

function existing(): string | null {
  for (const p of candidates()) {
    try {
      if (fs.statSync(p).size > 1_000_000) return p;
    } catch {
      /* not there */
    }
  }
  return null;
}

let pending: Promise<string> | null = null;

export type FetchProgress = (received: number, total: number) => void;

export function ensureFfmpeg(onProgress?: FetchProgress, signal?: AbortSignal): Promise<string> {
  const found = existing();
  if (found) return Promise.resolve(found);
  pending ??= download(onProgress, signal).finally(() => {
    pending = null;
  });
  return pending;
}

async function download(onProgress?: FetchProgress, signal?: AbortSignal): Promise<string> {
  const key = `${process.platform}-${process.arch}`;
  const target = path.join(app.getPath('userData'), 'bin', exe);
  const temp = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });

  log.info(`fetching ffmpeg ${RELEASE} for ${key}`);
  const res = await fetch(`${URL_BASE}/ffmpeg-${key}.gz`, { signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Could not fetch ffmpeg (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;

  let received = 0;
  let lastReport = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastReport > 200) {
        lastReport = now;
        onProgress(received, total);
      }
      cb(null, chunk);
    },
  });
  const hash = crypto.createHash('sha256');
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body as never), meter, zlib.createGunzip(), hasher, fs.createWriteStream(temp), { signal });
    const digest = hash.digest('hex');
    const expected = EXPECTED_SHA256[key];
    if (expected && digest !== expected) throw new Error('The downloaded ffmpeg failed its integrity check.');
    if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, target);
    log.info('ffmpeg ready at', target);
    return target;
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

/** Where ffmpeg lives (or will live once fetched), for the folder-protection allow list. */
export function ffmpegPath(): string {
  return existing() ?? path.join(app.getPath('userData'), 'bin', exe);
}

export function ffmpegAvailable(): boolean {
  return existing() !== null;
}
