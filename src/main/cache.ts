/**
 * Small TTL cache that also de-duplicates concurrent requests for the same key,
 * so five components asking for the same AniList page trigger one request.
 */
export class TtlCache {
  private values = new Map<string, { at: number; ttl: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();

  constructor(private maxEntries = 500) {}

  get<T>(key: string): T | undefined {
    const hit = this.values.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > hit.ttl) {
      this.values.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number) {
    if (this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    this.values.set(key, { at: Date.now(), ttl: ttlMs, value });
  }

  delete(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }

  async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
    if (!force) {
      const hit = this.get<T>(key);
      if (hit !== undefined) return hit;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;
    const p = load()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
}
