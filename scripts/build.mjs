import { resolve } from 'node:path';
import * as esbuild from 'esbuild';
import { build } from 'vite';
import { nodeBuildOptions } from './esbuild.config.mjs';

const root = resolve(import.meta.dirname, '..');

await build({ configFile: resolve(root, 'vite.config.mts'), logLevel: 'warn' });
await esbuild.build(nodeBuildOptions({ dev: false }));
console.log('[build] out/ is ready');
