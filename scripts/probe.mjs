import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { nodeBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');
const base = nodeBuildOptions({ dev: true });

await esbuild.build({
  ...base,
  entryPoints: [{ in: 'scripts/probe.ts', out: 'probe/index' }],
});

const electron = createRequire(import.meta.url)('electron');
const result = spawnSync(electron, [resolve(root, 'out/probe/index.cjs'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
