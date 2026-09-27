import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/*
 * The ad blocker looks up the path of its page script (for cosmetic filtering) as soon as
 * it loads. PlayzAnime only uses it to filter requests and never injects that script, and
 * once bundled there is no node_modules to look in, so the lookup is replaced with nothing.
 */
const stubAdblockPreload = {
  name: 'stub-adblock-preload',
  setup(build) {
    build.onResolve({ filter: /preload_path(\.js)?$/ }, (args) =>
      args.importer.includes('adblocker-electron') ? { path: 'adblock-preload-path', namespace: 'stub' } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const PRELOAD_PATH = "";', loader: 'js' }));
  },
};

/**
 * Main and preload both compile to CommonJS for Electron. Every library is bundled in, so the
 * packaged app carries only the code it uses and no node_modules folder.
 */
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
    external: ['electron'],
    plugins: [stubAdblockPreload],
    sourcemap: dev ? 'inline' : false,
    minify: !dev,
    legalComments: dev ? 'inline' : 'linked',
    logLevel: 'warning',
  };
}
