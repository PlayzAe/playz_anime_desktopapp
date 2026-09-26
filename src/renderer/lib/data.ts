import { useEffect, useReducer, useRef } from 'react';

/*
 * Stale-while-revalidate loader. Components share results by key, so the home
 * page and the series page never ask the main process twice for the same thing.
 */

interface Entry {
  data?: unknown;
  error?: Error;
  at: number;
  promise?: Promise<void>;
}

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

function run(key: string, load: () => Promise<unknown>, force = false) {
  const entry = cache.get(key) ?? { at: 0 };
  if (entry.promise && !force) return;
  entry.promise = load()
    .then(
      (data) => {
        entry.data = data;
        entry.error = undefined;
      },
      (err: unknown) => {
        entry.error = err instanceof Error ? err : new Error(String(err));
      },
    )
    .finally(() => {
      entry.at = Date.now();
      entry.promise = undefined;
      notify(key);
    });
  cache.set(key, entry);
  notify(key);
}

export interface Loaded<T> {
  data: T | undefined;
  error: Error | null;
  /** True only while there is nothing to show yet. */
  loading: boolean;
  /** True whenever a request is in flight, including background refreshes. */
  refreshing: boolean;
  reload: () => void;
}

export function useLoader<T>(key: string | null, load: () => Promise<T>, staleMs = 5 * 60_000): Loaded<T> {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) return;
    let set = subscribers.get(key);
    if (!set) subscribers.set(key, (set = new Set()));
    set.add(rerender);
    const entry = cache.get(key);
    if (!entry || (!entry.promise && Date.now() - entry.at > staleMs) || (entry.error && !entry.data && !entry.promise)) {
      run(key, loadRef.current);
    }
    rerender();
    return () => {
      set.delete(rerender);
    };
  }, [key, staleMs]);

  const entry = key ? cache.get(key) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.data === undefined ? (entry?.error ?? null) : null,
    loading: Boolean(key) && entry?.data === undefined && !entry?.error,
    refreshing: Boolean(entry?.promise),
    reload: () => {
      if (key) run(key, loadRef.current, true);
    },
  };
}

/** Seeds the cache, e.g. with data fetched as part of a larger response. */
export function prime(key: string, data: unknown) {
  if (cache.get(key)?.data !== undefined) return;
  cache.set(key, { data, at: Date.now() });
}

export function invalidate(prefix = '') {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
