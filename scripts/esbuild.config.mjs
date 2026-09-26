import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** Main and preload both compile to CommonJS for Electron; runtime dependencies stay in node_modules. */
export function nodeBuildOptions({ dev }) {
  return {
    absWorkingDir: root,
    entryPoints: [
      { in: 'src/main/index.ts', out: 'main/index' },
      { in: 'src/preload/index.ts', out: 'preload/index' },
    ],
    outdir: 'out',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', ...Object.keys(pkg.dependencies ?? {})],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    logLevel: 'warning',
  };
}
