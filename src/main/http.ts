// A desktop Chrome user agent. Several providers reject requests that carry
// Electron's default UA or no UA at all.
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body = '',
    /** Seconds from a Retry-After header, 0 when absent. */
    public retryAfter = 0,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  method?: string;
  body?: string;
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    body: opts.body,
    headers: { 'User-Agent': CHROME_UA, ...opts.headers },
    signal: withTimeout(opts.timeoutMs ?? 15000, opts.signal),
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 2000);
    throw new HttpError(res.status, url, body, Number(res.headers.get('retry-after')) || 0);
  }
  return res;
}

export async function getText(url: string, opts?: RequestOptions): Promise<string> {
  return (await request(url, opts)).text();
}

export async function getJson<T>(url: string, opts?: RequestOptions): Promise<T> {
  return (await request(url, { ...opts, headers: { Accept: 'application/json', ...opts?.headers } })).json() as Promise<T>;
}

export async function getBuffer(url: string, opts?: RequestOptions): Promise<Buffer> {
  return Buffer.from(await (await request(url, opts)).arrayBuffer());
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Retries transient failures (network errors, 429, 5xx). "Too many requests"
 * gets a real pause: the server's Retry-After, else an exponential wait up to 30 s,
 * because hammering a rate-limited CDN only extends the ban.
 */
export async function retry<T>(fn: () => Promise<T>, attempts = 3, signal?: AbortSignal, onRateLimit?: () => void): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (signal?.aborted) throw err;
      const status = err instanceof HttpError ? err.status : 0;
      if (status && status < 500 && status !== 429) throw err;
      if (i === attempts - 1) break;
      let wait = 400 * (i + 1) ** 2;
      if (status === 429 || status === 503) {
        onRateLimit?.();
        const after = err instanceof HttpError ? err.retryAfter * 1000 : 0;
        wait = Math.min(30_000, after || 1500 * 2 ** i) + Math.random() * 500;
      }
      await sleep(wait, signal);
    }
  }
  throw last;
}
