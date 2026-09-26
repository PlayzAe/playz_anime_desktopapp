// Launches the built app with a throwaway profile and screenshots routes.
//   node scripts/shot.mjs <outDir> /route1 /route2 ...
// Each route may carry "@wait=ms" and "@scroll=px", e.g. "/anime/154587@wait=4000@scroll=600".
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const [outDir = join(tmpdir(), 'playzanime-shots'), ...routes] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
// One reused profile keeps AniList images and the ad-block list cached between runs (saves data).
const profile = process.env.SHOT_PROFILE || join(tmpdir(), 'playzanime-test-profile');

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, PLAYZANIME_USER_DATA: profile },
});
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(Number(process.env.SHOT_W || 1440), Number(process.env.SHOT_H || 900));
  w.center();
});
win.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text());
});
win.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (process.env.SHOT_NET) {
  win.on('response', (r) => {
    if (r.status() >= 400) console.log(`[net ${r.status()}] ${r.request().resourceType()} ${r.url().slice(0, 160)}`);
  });
  win.on('requestfailed', (r) => console.log(`[net failed] ${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
}

await win.waitForLoadState('domcontentloaded');
// Tests run with data saver on: small video buffers and compressed manga pages.
await win.waitForFunction(() => Boolean(window.playzanime));
const extra = JSON.parse(process.env.SHOT_SETTINGS || '{}');
await win.evaluate((patch) => window.playzanime.settings.set({ dataSaver: true, ...patch }), extra);
await win.reload();
await win.waitForTimeout(1500);

let i = 0;
for (const spec of routes.length ? routes : ['/']) {
  const [route, ...opts] = spec.split('@');
  const opt = Object.fromEntries(opts.map((o) => o.split('=')));
  await win.evaluate((r) => (location.hash = `#${r}`), route);
  await win.waitForTimeout(Number(opt.wait ?? 3500));
  if (opt.scroll) {
    await win.evaluate((y) => document.querySelector('.main')?.scrollTo(0, Number(y)), opt.scroll);
    await win.waitForTimeout(900);
  }
  const name = `${String(++i).padStart(2, '0')}-${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}${opt.scroll ? `-s${opt.scroll}` : ''}.png`;
  await win.screenshot({ path: join(outDir, name) });
  // Stop any video right after the capture so it doesn't keep buffering.
  await win.evaluate(() => document.querySelectorAll('video').forEach((v) => (v.pause(), v.removeAttribute('src'), v.load())));
  console.log('saved', join(outDir, name));
}

await app.close();
