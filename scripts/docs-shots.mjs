// README screenshots from a demo profile.
//   npm run build && npm run docs:shots
// Almost no data: posters come from the test profile's image cache (copied, never modified),
// and the "downloads" are tiny test-pattern files made locally with ffmpeg. Nothing streams.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { _electron as electron } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const source = process.env.SHOT_PROFILE || join(tmpdir(), 'playzanime-test-profile');
const profile = join(tmpdir(), 'playzanime-docs-profile');
const files = join(tmpdir(), 'playzanime-docs-files');
const out = join(root, 'docs', 'screenshots');

// ── A fresh copy of the test profile (keeps its image cache) ──
fs.rmSync(profile, { recursive: true, force: true });
fs.cpSync(source, profile, { recursive: true, filter: (p) => !/Singleton|DevToolsActivePort|lockfile/i.test(p) });
fs.rmSync(files, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const feed = JSON.parse(fs.readFileSync(join(profile, 'feed-cache.json'), 'utf8'));
const home = feed['home:true']?.value;
const mangaFeed = feed['mangaHome:true']?.value;
if (!home || !mangaFeed) throw new Error('The test profile has no cached home feed yet. Open the app with it once first.');

const snap = (m, type) => ({
  id: m.id,
  type,
  title: m.title.english || m.title.romaji,
  romaji: m.title.romaji ?? null,
  native: m.title.native ?? null,
  cover: m.coverImage?.large || m.coverImage?.extraLarge || '',
  banner: m.bannerImage ?? null,
  color: m.coverImage?.color ?? null,
  format: m.format ?? null,
  episodes: m.episodes ?? null,
  chapters: m.chapters ?? null,
  year: m.seasonYear ?? m.startDate?.year ?? null,
  status: m.status ?? null,
});
const uniq = (list) => [...new Map(list.map((m) => [m.id, m])).values()];
const anime = uniq([...home.trending, ...home.season, ...home.top]).map((m) => snap(m, 'ANIME'));
const manga = uniq([...mangaFeed.trending, ...mangaFeed.manhwa, ...mangaFeed.top]).map((m) => snap(m, 'MANGA'));
const now = Date.now();
const H = 3_600_000;

// ── Demo "downloads": real, playable, tiny ──
const safe = (s) => s.replace(/[<>:"/\\|?*]/g, '').trim();
const clip = join(files, 'clip.mp4');
fs.mkdirSync(files, { recursive: true });
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', clip]);
const pageDir = join(files, 'pages');
fs.mkdirSync(pageDir, { recursive: true });
for (let i = 1; i <= 3; i++) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=800x1200:rate=1`, '-frames:v', '1', '-vf', `hue=h=${i * 90}`, join(pageDir, `${String(i).padStart(3, '0')}.png`)]);
}

const jobs = [];
let n = 0;
const episodeJob = (media, episode, resolution, audio, mb) => {
  const show = safe(media.title);
  const dir = join(files, 'PlayzAnime', show);
  fs.mkdirSync(dir, { recursive: true });
  const file = join(dir, `${show}_E${String(episode).padStart(2, '0')}_${resolution}${audio === 'dub' ? '_DUB' : ''}.mp4`);
  fs.copyFileSync(clip, file);
  jobs.push({
    id: `demo-${++n}`, kind: 'episode', media, label: `E${String(episode).padStart(2, '0')}`, episode, audio, quality: 'best',
    embedUrl: 'https://example.invalid/', state: 'done', stage: null, progress: 1, bytes: mb * 1048576, speed: 0,
    partsDone: 1, partsTotal: 1, resolution, outputFile: file, subtitleFile: null, error: null, createdAt: now - n * H, finishedAt: now - n * H,
  });
};
const chapterJob = (media, number) => {
  const series = safe(media.title);
  const dir = join(files, 'PlayzManga', series);
  fs.mkdirSync(dir, { recursive: true });
  const zip = join(dir, `${series}_Ch${String(number).padStart(3, '0')}.zip`);
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${pageDir}\\*' -DestinationPath '${zip.replaceAll("'", "''")}' -Force`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const file = zip.replace(/\.zip$/, '.cbz');
  fs.renameSync(zip, file);
  jobs.push({
    id: `demo-${++n}`, kind: 'chapter', media, label: `Ch. ${number}`,
    chapter: { id: `mangadex:demo-${n}`, provider: 'mangadex', number: String(number), title: null, volume: null, group: null, pages: 3, publishedAt: null, externalUrl: null },
    state: 'done', stage: null, progress: 1, bytes: 14 * 1048576, speed: 0, partsDone: 3, partsTotal: 3, outputFile: file, error: null, createdAt: now - n * H, finishedAt: now - n * H,
  });
};
episodeJob(anime[0], 1, '720p', 'sub', 182);
episodeJob(anime[0], 2, '720p', 'sub', 176);
episodeJob(anime[0], 3, '720p', 'sub', 179);
episodeJob(anime[0], 3, '480p', 'dub', 96);
episodeJob(anime[3], 1, '1080p', 'sub', 402);
chapterJob(manga[1], 1);
chapterJob(manga[1], 2);
chapterJob(manga[4], 12);

// ── Demo lists and profiles ──
const statuses = ['watching', 'watching', 'planning', 'completed', 'watching', 'paused', 'planning', 'completed'];
const library = {};
anime.slice(0, 8).forEach((m, i) => (library[m.id] = { media: m, status: statuses[i], addedAt: now - i * 24 * H, updatedAt: now - i * H }));
manga.slice(0, 4).forEach((m, i) => (library[m.id] = { media: m, status: i < 2 ? 'watching' : 'planning', addedAt: now - i * 24 * H, updatedAt: now - i * H }));
const history = {};
anime.slice(0, 5).forEach((m, i) => (history[m.id] = { media: m, episode: 3 + i, episodeTitle: null, thumbnail: null, position: 300 + i * 200, duration: 1420, audio: 'sub', updatedAt: now - i * 2 * H }));
const reading = {};
manga.slice(0, 3).forEach((m, i) => (reading[m.id] = { media: m, chapterId: `mangadex:demo-r${i}`, chapterNumber: String(12 + i * 7), chapterTitle: null, page: 4, pages: 18, updatedAt: now - i * 3 * H }));

const friendLists = (offset) => ({
  library: anime.slice(offset, offset + 10).map((m, i) => ({ media: m, status: ['watching', 'completed', 'planning'][i % 3], addedAt: now, updatedAt: now })),
  history: anime.slice(offset + 2, offset + 9).map((m, i) => ({ media: m, episode: 2 + i * 3, position: 600, duration: 1420, audio: 'sub', updatedAt: now - i * H })),
  reading: manga.slice(offset, offset + 6).map((m, i) => ({ media: m, chapterId: `mangadex:f${i}`, chapterNumber: String(40 + i * 11), page: 1, pages: 20, updatedAt: now - i * H })),
});

const data = {
  version: 2,
  settings: { accent: 'shu', dataSaver: true, animeDir: join(files, 'PlayzAnime'), mangaDir: join(files, 'PlayzManga'), notifyDownloads: false },
  library,
  history,
  watched: {},
  reading,
  read: {},
  downloads: jobs,
  window: { width: 1440, height: 900, maximized: false },
  setupDone: true,
  profile: { id: 'demo-rin', name: 'Rin', avatar: null, tagline: 'Seinen first, then whatever’s airing.', favorites: [...anime.slice(0, 4), ...manga.slice(0, 2)], createdAt: now },
  imported: [
    { format: 'playzanime-profile', version: 1, exportedAt: now - 2 * H, importedAt: now - H, profile: { id: 'demo-aki', name: 'Aki', avatar: null, tagline: 'Manhwa at 2am, romance on Sundays.', favorites: [...manga.slice(4, 8), ...anime.slice(9, 11)], createdAt: now }, ...friendLists(8) },
    { format: 'playzanime-profile', version: 1, exportedAt: now - 30 * H, importedAt: now - 26 * H, profile: { id: 'demo-sora', name: 'Sora', avatar: null, tagline: null, favorites: anime.slice(14, 18), createdAt: now }, ...friendLists(14) },
  ],
};
fs.writeFileSync(join(profile, 'playzanime-data.json'), JSON.stringify(data));

// ── Capture ──
const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, PLAYZANIME_USER_DATA: profile } });
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1440, 900);
  w.center();
});
win.on('pageerror', (e) => console.log('[pageerror]', e.message));
const shot = async (name) => {
  await win.screenshot({ path: join(out, `${name}.png`) });
  console.log('saved', name);
};

// The intro plays on every launch; let it finish.
await win.waitForTimeout(4500);

const routes = [
  ['home', '/', 3500],
  ['manga', '/manga', 3000],
  ['downloads', '/downloads', 2000],
  ['profiles', '/profiles', 2000],
  ['friend', '/profiles/demo-aki', 2000],
  ['settings', '/settings', 2500],
];
for (const [name, route, wait] of routes) {
  await win.evaluate((r) => (location.hash = `#${r}`), route);
  await win.waitForTimeout(wait);
  await shot(name);
}
await app.close();
