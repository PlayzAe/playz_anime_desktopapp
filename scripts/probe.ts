// Checks every provider end to end.
//   npm run probe -- anime <anilistId>   AniList → episode match → stream resolve
//   npm run probe -- manga <anilistId>   AniList → MangaDex + MangaPill chapters → pages
import { app } from 'electron';
import * as anilist from '../src/main/anilist';
import { listEpisodes } from '../src/main/episodes';
import { resolveStream } from '../src/main/extractor';
import { chapterList, chapterPages } from '../src/main/manga';

const args = process.argv.slice(2);
const kind = args.includes('manga') ? 'manga' : 'anime';
const id = Number(args.find((a) => /^\d+$/.test(a)) ?? (kind === 'manga' ? 118586 : 154587));

// The hidden resolver window closing must not end the probe.
app.on('window-all-closed', () => {});

async function probeAnime() {
  const t0 = Date.now();
  const home = await anilist.home();
  console.log(`home: ${home.trending.length} trending, ${home.season.length} season, ${home.top.length} top (${Date.now() - t0}ms)`);

  const media = await anilist.media(id);
  console.log(`media ${id}: ${media.title.english ?? media.title.romaji} · mal ${media.idMal} · ${media.streamingEpisodes?.length ?? 0} streaming eps`);

  const t1 = Date.now();
  const eps = await listEpisodes(id);
  console.log(`episodes: ${eps.episodes.length} (source ${eps.sourceId}, fallback ${eps.fallback}, dub ${eps.hasDub}) in ${Date.now() - t1}ms`);
  console.log('  first:', JSON.stringify(eps.episodes[0]));

  const t2 = Date.now();
  const stream = await resolveStream(eps.episodes[0].subUrl!);
  console.log(`stream resolved in ${Date.now() - t2}ms on ${stream.host}`);
  console.log('  variants:', stream.variants.map((v) => `${v.label}@${Math.round(v.bandwidth / 1000)}k`).join(', '));
  console.log('  subtitles:', stream.subtitles.map((s) => s.label).join(', ') || 'none');
  console.log('  intro:', JSON.stringify(stream.intro), 'outro:', JSON.stringify(stream.outro));
}

/** `npm run probe -- manga shelf`: which source (if any) serves each title on the Manhwa shelf. */
async function probeShelf() {
  const feed = await anilist.mangaHome();
  let missing = 0;
  for (const m of feed.manhwa) {
    const list = await chapterList(m.id);
    const found = list.providers.filter((p) => p.chapterCount > 0).map((p) => `${p.provider}:${p.latest ?? p.chapterCount}`);
    if (!list.provider) missing++;
    console.log(`${list.provider ? 'ok  ' : 'NONE'} ${m.id} ${(m.title.english ?? m.title.romaji ?? '').slice(0, 44).padEnd(44)} ${found.join(' ') || '-'}`);
  }
  console.log(`${feed.manhwa.length - missing}/${feed.manhwa.length} readable`);
}

async function probeManga() {
  if (args.includes('shelf')) return probeShelf();
  const t0 = Date.now();
  const feed = await anilist.mangaHome();
  console.log(`manga home: ${feed.trending.length} trending, ${feed.manhwa.length} manhwa, ${feed.top.length} top (${Date.now() - t0}ms)`);

  const media = await anilist.media(id);
  console.log(`media ${id}: ${media.title.english ?? media.title.romaji} · ${media.format} · chapters ${media.chapters ?? '?'}`);

  const t1 = Date.now();
  const list = await chapterList(id);
  console.log(`chapters in ${Date.now() - t1}ms → using ${list.provider}`);
  for (const p of list.providers) console.log(`  ${p.provider}: ${p.chapterCount} ch, latest ${p.latest}, source ${p.sourceId}${p.error ? ` (error: ${p.error})` : ''}`);

  const first = list.chapters.find((c) => !c.externalUrl);
  if (!first) return console.log('  no readable chapter');
  const t2 = Date.now();
  const pages = await chapterPages(first);
  console.log(`  chapter ${first.number}: ${pages.length} pages in ${Date.now() - t2}ms; first ${pages[0]?.url}`);
}

app.whenReady().then(async () => {
  try {
    await (kind === 'manga' ? probeManga() : probeAnime());
  } catch (err) {
    console.error('PROBE FAILED:', err);
    process.exitCode = 1;
  }
  app.quit();
});
