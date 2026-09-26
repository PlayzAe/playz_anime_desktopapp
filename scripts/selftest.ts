// Offline end-to-end test of the download pipeline. Uses no internet:
// ffmpeg generates an 8-second AES-128 HLS stream with a subtitle track, a local
// server plays the part of the embed site, and the real downloader (hidden-window
// capture → playlist parse → parallel segments → decrypt → mux) runs against it.
//   npm run selftest
import { app, net, protocol } from 'electron';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'playzanime-selftest-'));
app.setPath('userData', path.join(work, 'profile'));
app.on('window-all-closed', () => {});
// Same registration as the app, so offline playback is tested through the real protocol.
protocol.registerSchemesAsPrivileged([{ scheme: 'pzmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const ffmpeg = process.env.FFMPEG_BIN!;

function makeStream(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(16);
  fs.writeFileSync(path.join(dir, 'enc.key'), key);
  fs.writeFileSync(path.join(dir, 'keyinfo'), `enc.key\n${path.join(dir, 'enc.key')}\n`);
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod',
    '-hls_key_info_file', path.join(dir, 'keyinfo'),
    '-hls_segment_filename', path.join(dir, 'seg%02d.ts'),
    path.join(dir, 'index.m3u8'),
  ]);
  fs.writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180\nindex.m3u8\n');
  fs.writeFileSync(path.join(dir, 'eng.vtt'), 'WEBVTT\n\n00:00:00.500 --> 00:00:03.000\nSelf-test subtitle\n');
  // The "embed page" requests the playlist the way a real player would.
  fs.writeFileSync(path.join(dir, 'embed.html'), '<!doctype html><script>fetch("eng.vtt");fetch("master.m3u8");</script>');
}

// Fault injection: seg02 answers "429 Too Many Requests" twice; seg07 fails while `breakSeg07` is set.
const hits = new Map<string, number>();
let breakSeg07 = true;

function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const types: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.vtt': 'text/vtt', '.html': 'text/html', '.key': 'application/octet-stream' };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const count = (hits.get(name) ?? 0) + 1;
    hits.set(name, count);
    if (name === '/seg02.ts' && count <= 2) {
      res.writeHead(429, { 'Retry-After': '1' }).end();
      return;
    }
    if (name === '/seg07.ts' && breakSeg07) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(dir, name);
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    }),
  );
}

app.whenReady().then(async () => {
  let failed = false;
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed = true;
  };

  try {
    // Imported after setPath so the store opens in the throwaway profile.
    const { store } = await import('../src/main/store');
    const { downloader } = await import('../src/main/downloader');
    const { writeZip, comicInfo } = await import('../src/main/zip');

    const streamDir = path.join(work, 'stream');
    makeStream(streamDir);
    const server = await serve(streamDir);
    const outDir = path.join(work, 'downloads');
    fs.mkdirSync(outDir, { recursive: true });
    store().patchSettings({ animeDir: outDir, mangaDir: outDir, notifyDownloads: false });

    const job = downloader().start({
      kind: 'episode',
      media: { id: 1, type: 'ANIME', title: 'Self Test', cover: '', format: 'TV' },
      episode: 1,
      episodeTitle: 'Test Pattern',
      audio: 'sub',
      embedUrl: `${server.url}/embed.html`,
      quality: 'best',
    });

    type Job = ReturnType<ReturnType<typeof downloader>['list']>[number];
    const settle = () =>
      new Promise<Job>((resolve) => {
        let last = '';
        const started = Date.now();
        const timer = setInterval(() => {
          const j = downloader().list().find((x) => x.id === job.id)!;
          const now = `  ${j.state}${j.stage ? ` (${j.stage})` : ''} ${j.partsDone}/${j.partsTotal}`;
          if (now !== last) console.log(now);
          last = now;
          if (['done', 'error', 'cancelled'].includes(j.state) || Date.now() - started > 90_000) {
            clearInterval(timer);
            resolve(j);
          }
        }, 300);
      });

    // First attempt dies on segment 7; whatever finished stays on disk.
    const broken = await settle();
    check(broken.state === 'error', `a failing segment stops the job (state=${broken.state})`);
    const seg00Before = hits.get('/seg00.ts') ?? 0;

    // Resume: only missing segments are fetched again; the 429s on seg02 are waited out.
    breakSeg07 = false;
    downloader().retry(job.id);
    const final = await settle();
    server.close();
    check(seg00Before === 1 && (hits.get('/seg00.ts') ?? 0) === 1, 'resume did not re-download finished segments');
    check((hits.get('/seg02.ts') ?? 0) >= 3, 'two “429 Too Many Requests” answers were waited out, not fatal');

    check(final.state === 'done', `episode job finished (state=${final.state}${final.error ? `, error=${final.error}` : ''})`);
    check(final.partsTotal === final.partsDone && final.partsTotal >= 8, `all ${final.partsTotal} encrypted segments fetched and decrypted`);
    const out = final.outputFile ?? '';
    check(out.endsWith('.mp4') && fs.existsSync(out) && fs.statSync(out).size > 10_000, `MP4 written: ${path.basename(out)}`);
    if (fs.existsSync(out)) {
      let info = '';
      try {
        execFileSync(ffmpeg, ['-hide_banner', '-i', out], { stdio: 'pipe' });
      } catch (err) {
        info = String((err as { stderr?: Buffer }).stderr ?? '');
      }
      check(/Video: h264/.test(info), 'MP4 has the H.264 video stream');
      check(/Audio: aac/.test(info), 'MP4 has the AAC audio stream');
      check(/Subtitle: mov_text/.test(info), 'MP4 has the embedded English subtitle track');
      check(/Duration: 00:00:0[78]/.test(info), 'duration is about 8 seconds');
    }

    // Offline playback: the in-app player reads the finished file through pzmedia://,
    // with Range requests (seeking) and the app's own subtitle copy.
    const { serveOfflineMedia, offlineItems, cbzPage } = await import('../src/main/offline');
    serveOfflineMedia();
    const item = offlineItems().find((i) => i.jobId === job.id);
    check(Boolean(item?.subtitles), 'offline library lists the episode, with subtitles');
    const ranged = await net.fetch(`pzmedia://job/${job.id}`, { headers: { Range: 'bytes=0-99' } });
    const head = Buffer.from(await ranged.arrayBuffer());
    check(ranged.status === 206 && head.length === 100 && head.subarray(4, 8).toString() === 'ftyp', `offline video answers a seek (Range) request (HTTP ${ranged.status}, ${head.length} bytes)`);
    const subs = await (await net.fetch(`pzmedia://job/${job.id}/subs`)).text();
    check(subs.includes('Self-test subtitle'), 'offline subtitles are served');
    const size = fs.statSync(out).size;
    const tail = await net.fetch(`pzmedia://job/${job.id}`, { headers: { Range: `bytes=${size - 10}-` } });
    check(tail.status === 206 && tail.headers.get('content-range') === `bytes ${size - 10}-${size - 1}/${size}` && (await tail.arrayBuffer()).byteLength === 10, 'offline video serves an open-ended range from the end');
    const stranger = await net.fetch('pzmedia://job/not-a-download');
    check(stranger.status === 404, 'files that are not downloads cannot be read through pzmedia');

    // CBZ writer: write a tiny archive and read it back with Windows' own unzip.
    const cbz = path.join(outDir, 'selftest.cbz');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    // Pack a chapter the size of a heavy real one (25 pages × 3 MB) and measure how long
    // the main thread is ever blocked while it happens. Long blocks are what freeze the window.
    const big = Array.from({ length: 25 }, (_, i) => ({ name: `${String(i + 3).padStart(3, '0')}.jpg`, data: crypto.randomBytes(3 * 1024 * 1024) }));
    let worstBlock = 0;
    let lastBeat = Date.now();
    const beat = setInterval(() => {
      worstBlock = Math.max(worstBlock, Date.now() - lastBeat - 20);
      lastBeat = Date.now();
    }, 20);
    await writeZip(cbz, [{ name: '001.png', data: png }, { name: '002.png', data: png }, ...big, comicInfo('Self Test', '1', 'Pilot', 27)]);
    clearInterval(beat);
    check(worstBlock < 300, `packing a 75 MB chapter never blocked the app for long (worst ${worstBlock} ms)`);
    // stdin is ignored explicitly: PowerShell waits on a redirected stdin that never closes.
    const listing = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${cbz}').Entries | % { $_.FullName + ':' + $_.Length }`],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
    ).toString();
    check(/001\.png:\d+/.test(listing) && /ComicInfo\.xml/.test(listing), `CBZ opens and lists its pages (${listing.trim().split(/\s+/).length} entries)`);

    // The in-app reader pulls pages straight out of the CBZ, in order, skipping ComicInfo.xml.
    const first = await cbzPage(cbz, 0);
    const third = await cbzPage(cbz, 2);
    check(first?.name === '001.png' && first.data.equals(png), 'reader gets page 1 back byte for byte');
    check(third?.name === '003.jpg' && third.data.equals(big[0].data), 'reader gets a 3 MB page back byte for byte');
    check((await cbzPage(cbz, 27)) === null, 'reader stops after the last page (ComicInfo.xml is not a page)');

    // CBZs made by other tools are usually compressed; Windows' own zipper makes one.
    const loose = path.join(work, 'downloads', 'loose');
    fs.mkdirSync(loose, { recursive: true });
    const text = Buffer.from('page '.repeat(20_000));
    fs.writeFileSync(path.join(loose, '01.png'), text);
    const deflated = path.join(outDir, 'deflated.zip');
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${path.join(loose, '01.png')}' -DestinationPath '${deflated}' -Force`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    check((await cbzPage(deflated, 0))?.data.equals(text) === true, 'reader inflates compressed (deflate) archives too');

    // Profiles: a shared file is checked field by field; anything unexpected is dropped.
    const { parseProfileFile } = await import('../src/main/profiles');
    const shared = parseProfileFile(
      JSON.stringify({
        format: 'playzanime-profile',
        version: 1,
        profile: { id: 'friend-1', name: '  Friend  ', avatar: 'javascript:alert(1)', favorites: [{ id: 5, type: 'ANIME', title: 'Show', cover: 'http://evil.example/x.png' }] },
        library: [
          { media: { id: 5, type: 'ANIME', title: 'Show', cover: 'https://img.example/c.jpg' }, status: 'watching' },
          { media: { id: 6, type: 'ANIME', title: 'Bad status', cover: '' }, status: 'hacked' },
        ],
        history: [{ media: { id: 7, type: 'NOVEL', title: 'Wrong type' }, episode: 1 }],
      }),
    );
    check(shared.profile.name === 'Friend' && shared.profile.avatar === null, 'profile import trims the name and drops a non-image avatar');
    check(shared.profile.favorites[0]?.cover === '', 'profile import drops non-https image links');
    check(shared.library.length === 1 && shared.history.length === 0, 'profile import drops entries with unknown statuses or types');
    let rejected = false;
    try {
      parseProfileFile('{"format":"something-else"}');
    } catch {
      rejected = true;
    }
    check(rejected, 'files that are not PlayzAnime profiles are refused');
  } catch (err) {
    console.error('SELFTEST CRASHED:', err);
    failed = true;
  }
  // Chromium keeps the profile folder locked until exit, so only the test data is removed here.
  for (const dir of ['stream', 'downloads']) {
    try {
      fs.rmSync(path.join(work, dir), { recursive: true, force: true });
    } catch {
      /* left for the OS temp cleaner */
    }
  }
  console.log(failed ? '\nSelf-test FAILED' : '\nSelf-test passed');
  process.exitCode = failed ? 1 : 0;
  app.quit();
});
