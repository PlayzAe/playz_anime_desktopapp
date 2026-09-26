// Development runner: Vite serves the renderer with hot reload, esbuild watches
// main + preload, and Electron restarts whenever those rebuild.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { createServer } from 'vite';
import { nodeBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');
const electronPath = createRequire(import.meta.url)('electron');

const server = await createServer({ configFile: resolve(root, 'vite.config.mts') });
await server.listen();
const devUrl = (server.resolvedUrls?.local[0] ?? 'http://localhost:5199/').replace(/\/$/, '');
console.log(`[dev] renderer at ${devUrl}`);

let child = null;
let restarting = false;
let restartTimer = null;

function startElectron() {
  child = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PLAYZANIME_DEV_URL: devUrl, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  child.on('exit', (code) => {
    if (restarting) return;
    void server.close();
    process.exit(code ?? 0);
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!child) return startElectron();
    restarting = true;
    child.once('exit', () => {
      restarting = false;
      startElectron();
    });
    child.kill();
  }, 150);
}

const ctx = await esbuild.context({
  ...nodeBuildOptions({ dev: true }),
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) console.error('[dev] main/preload build failed');
          else restartElectron();
        });
      },
    },
  ],
});
await ctx.watch();

process.on('SIGINT', async () => {
  await ctx.dispose();
  await server.close();
  child?.kill();
  process.exit(0);
});
