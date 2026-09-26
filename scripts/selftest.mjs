import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { nodeBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');
const ffmpeg = resolve(root, 'node_modules/ffmpeg-static/ffmpeg.exe');
if (!existsSync(ffmpeg)) {
  console.error('The self-test needs node_modules/ffmpeg-static (a dev dependency). Run npm install first.');
  process.exit(1);
}

await esbuild.build({ ...nodeBuildOptions({ dev: true }), entryPoints: [{ in: 'scripts/selftest.ts', out: 'selftest/index' }] });

const electron = createRequire(import.meta.url)('electron');
const result = spawnSync(electron, [resolve(root, 'out/selftest/index.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FFMPEG_BIN: ffmpeg },
});
process.exit(result.status ?? 1);
