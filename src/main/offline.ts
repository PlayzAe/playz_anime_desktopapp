import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { OfflineItem } from '../shared/types';
import { appSubtitlePath, downloader } from './downloader';
import { logger } from './log';

const log = logger('offline');
const inflateRaw = promisify(zlib.inflateRaw);

/*
 * Downloaded episodes and chapters play inside the app with no internet.
 * The page asks for pzmedia://job/<jobId>[/<page>] and only files this app
 * downloaded itself can be reached that way.
 */

export const MEDIA_SCHEME = 'pzmedia';

export function offlineItems(): OfflineItem[] {
  return downloader()
    .list()
    .filter((j) => j.state === 'done' && j.outputFile)
    .map((j) => ({
      jobId: j.id,
      kind: j.kind,
      media: j.media,
      label: j.label,
      episode: j.episode,
      chapterId: j.chapter?.id ?? null,
      chapterNumber: j.chapter?.number ?? null,
      quality: j.resolution ?? null,
      audio: j.audio,
      subtitles: Boolean(j.subtitleFile) || fs.existsSync(appSubtitlePath(j.id)),
      file: j.outputFile!,
      bytes: j.bytes,
      finishedAt: j.finishedAt ?? j.createdAt,
    }));
}

function fileForJob(jobId: string): string | null {
  return downloader().list().find((j) => j.id === jobId && j.state === 'done')?.outputFile ?? null;
}

// ── CBZ reading ─────────────────────────────────────────────────────────────

interface ZipEntryRef {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

const directories = new Map<string, ZipEntryRef[]>();

async function readDirectory(file: string): Promise<ZipEntryRef[]> {
  // Keyed by size and time too, so a chapter downloaded again under the same name is re-read.
  const st = await fs.promises.stat(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const cached = directories.get(key);
  if (cached) return cached;
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailSize = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, size - tailSize);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('Not a CBZ/ZIP file.');
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirOffset);
    const entries: ZipEntryRef[] = [];
    for (let p = 0, i = 0; i < count && p < dir.length; i++) {
      const method = dir.readUInt16LE(p + 10);
      const compressedSize = dir.readUInt32LE(p + 20);
      const nameLen = dir.readUInt16LE(p + 28);
      const extraLen = dir.readUInt16LE(p + 30);
      const commentLen = dir.readUInt16LE(p + 32);
      const offset = dir.readUInt32LE(p + 42);
      const name = dir.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      if (/\.(jpe?g|png|webp|gif|avif)$/i.test(name)) entries.push({ name, method, compressedSize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    directories.set(key, entries);
    return entries;
  } finally {
    await fh.close();
  }
}

async function readEntry(file: string, entry: ZipEntryRef): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(30);
    await fh.read(header, 0, 30, entry.offset);
    const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = Buffer.alloc(entry.compressedSize);
    await fh.read(data, 0, entry.compressedSize, start);
    return entry.method === 8 ? await inflateRaw(data) : data;
  } finally {
    await fh.close();
  }
}

/** One page of a CBZ, in reading order; null past the last page. */
export async function cbzPage(file: string, index: number): Promise<{ name: string; data: Buffer } | null> {
  const entry = (await readDirectory(file))[index];
  return entry ? { name: entry.name, data: await readEntry(file, entry) } : null;
}

export async function chapterPageCount(jobId: string): Promise<number> {
  const file = fileForJob(jobId);
  if (!file) throw new Error('That chapter is no longer in your downloads.');
  return (await readDirectory(file)).length;
}

/**
 * Videos answer byte ranges properly (206 + Content-Range), which is what lets the
 * player seek and start mid-file without reading everything before that point.
 */
async function serveVideo(file: string, range: string | null): Promise<Response> {
  const { size } = await fs.promises.stat(file);
  const type = file.toLowerCase().endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
  const base = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': type };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  // "bytes=500-" (from 500), "bytes=500-999", or "bytes=-500" (the last 500).
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  start = Math.max(0, start);
  end = Math.max(start, end);
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };

export function serveOfflineMedia() {
  // The player asks with crossorigin="anonymous" (it does for streams too), so every answer allows it.
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const [rawId, part] = url.pathname.replace(/^\/+/, '').split('/');
      const jobId = decodeURIComponent(rawId ?? '');
      const job = downloader().list().find((j) => j.id === jobId && j.state === 'done');
      const file = job?.outputFile;
      if (url.host !== 'job' || !file) return new Response('Not found', { status: 404, headers: CORS });

      if (part === 'subs') {
        const text = await fs.promises
          .readFile(appSubtitlePath(job.id), 'utf8')
          .catch(() => (job.subtitleFile ? fs.promises.readFile(job.subtitleFile, 'utf8') : null))
          .catch(() => null);
        if (text === null) return new Response('Not found', { status: 404, headers: CORS });
        return new Response(text, { headers: { ...CORS, 'Content-Type': 'text/vtt; charset=utf-8' } });
      }

      if (part !== undefined) {
        const page = await cbzPage(file, Number(part));
        if (!page) return new Response('Not found', { status: 404, headers: CORS });
        return new Response(new Uint8Array(page.data), {
          headers: { ...CORS, 'Content-Type': TYPES[path.extname(page.name).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
        });
      }

      return await serveVideo(file, request.headers.get('range'));
    } catch (err) {
      log.warn('offline media failed', String(err));
      return new Response('Unavailable', { status: 500 });
    }
  });
}
