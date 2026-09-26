import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/*
 * Hash routing: it works unchanged under the dev server and the app:// protocol.
 * Every entry carries an index in history.state so the title bar knows whether
 * back/forward are possible and each page can get its scroll position back.
 */

export type RouteName =
  | 'home'
  | 'mangaHome'
  | 'discover'
  | 'schedule'
  | 'library'
  | 'downloads'
  | 'settings'
  | 'anime'
  | 'manga'
  | 'watch'
  | 'read'
  | 'profiles'
  | 'profile'
  | 'offlineWatch'
  | 'offlineRead'
  | 'notfound';

export interface Route {
  name: RouteName;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** History index of this entry. */
  index: number;
  /** How we arrived here: 'pop' means back/forward, so restore scroll. */
  via: 'push' | 'replace' | 'pop';
}

const PATTERNS: [RouteName, RegExp, string[]][] = [
  ['home', /^\/?$/, []],
  ['discover', /^\/discover\/?$/, []],
  ['schedule', /^\/schedule\/?$/, []],
  ['library', /^\/library\/?$/, []],
  ['downloads', /^\/downloads\/?$/, []],
  ['settings', /^\/settings\/?$/, []],
  ['mangaHome', /^\/manga\/?$/, []],
  ['anime', /^\/anime\/(\d+)\/?$/, ['id']],
  ['manga', /^\/manga\/(\d+)\/?$/, ['id']],
  ['watch', /^\/watch\/(\d+)\/(\d+)\/?$/, ['id', 'ep']],
  // Chapter ids contain ':' and '/', so they travel URI-encoded.
  ['read', /^\/read\/(\d+)\/([^/]+)\/?$/, ['id', 'chapter']],
  ['profiles', /^\/profiles\/?$/, []],
  ['profile', /^\/profiles\/([^/]+)\/?$/, ['id']],
  ['offlineWatch', /^\/offline\/watch\/([^/]+)\/?$/, ['job']],
  ['offlineRead', /^\/offline\/read\/([^/]+)\/?$/, ['job']],
];

function parse(hash: string, index: number, via: Route['via']): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  for (const [name, re, keys] of PATTERNS) {
    const m = re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { name, path, params, query: new URLSearchParams(qs), index, via };
    }
  }
  return { name: 'notfound', path, params: {}, query: new URLSearchParams(qs), index, via };
}

if (typeof history.state?.idx !== 'number') history.replaceState({ idx: 0 }, '');

let index: number = history.state.idx;
let maxIndex = index;
let current = parse(location.hash, index, 'push');
const listeners = new Set<() => void>();

function emit(via: Route['via']) {
  current = parse(location.hash, index, via);
  listeners.forEach((l) => l());
}

window.addEventListener('popstate', (e) => {
  index = typeof e.state?.idx === 'number' ? e.state.idx : index + 1;
  if (index > maxIndex) maxIndex = index;
  emit('pop');
});

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (target === location.hash && !opts.replace) return;
  if (opts.replace) {
    history.replaceState({ idx: index }, '', target);
    emit('replace');
  } else {
    index += 1;
    maxIndex = index;
    history.pushState({ idx: index }, '', target);
    emit('push');
  }
}

export const goBack = () => index > 0 && history.back();
export const goForward = () => index < maxIndex && history.forward();
export const canGoBack = () => index > 0;
export const canGoForward = () => index < maxIndex;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** Builds a path with a query string, dropping empty values. */
export function withQuery(path: string, query: Record<string, string | number | null | undefined | false>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
}

export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={`#${to}`} onClick={handle} {...rest} />;
}
