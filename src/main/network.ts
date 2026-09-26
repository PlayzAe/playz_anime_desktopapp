import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { app, type Session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './log';

const log = logger('network');

/**
 * Stream and manga-image CDNs only answer when the request carries their site's
 * Referer, and they send no CORS headers. For hosts registered here we add the
 * Referer on the way out and an allow-origin header on the way back, so the
 * built-in player (hls.js) and the manga reader can load them directly.
 */
const refererHosts = new Map<string, string>();

export function registerRefererHosts(urls: string[], referer: string) {
  for (const u of urls) {
    try {
      const host = new URL(u).host;
      if (host) refererHosts.set(host, referer);
    } catch {
      /* not a URL */
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function setHeader(headers: Record<string, string | string[]>, name: string, value: string | string[]) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
  headers[name] = value;
}

// Hosts the app itself depends on. The blocker never touches them.
const NEVER_BLOCK = [
  /(^|\.)anilist\.co$/,
  /(^|\.)megaplay\.buzz$/,
  /(^|\.)mangadex\.(org|network)$/,
  /(^|\.)mangapill\.com$/,
  /(^|\.)weebcentral\.com$/,
  /(^|\.)planeptune\.us$/,
  /(^|\.)flamecomics\.xyz$/,
  /(^|\.)crunchyroll\.com$/,
  /(^|\.)youtube-nocookie\.com$/,
  /(^|\.)ytimg\.com$/,
];

let blocker: ElectronBlocker | null = null;
let blockingEnabled = true;

export function setAdblock(enabled: boolean) {
  blockingEnabled = enabled;
}

async function loadBlocker() {
  const cachePath = path.join(app.getPath('userData'), 'adblock-engine.bin');
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: async (p: string) => new Uint8Array(await fs.readFile(p)),
      write: async (p: string, buf: Uint8Array) => {
        await fs.writeFile(p, buf);
      },
    });
    log.info('ad blocker ready');
  } catch (err) {
    log.warn('ad blocker unavailable:', String(err));
  }
}

/**
 * Electron allows one listener per webRequest event and session, so the ad
 * blocker and our header rules share the same handlers.
 */
export function installNetworkRules(session: Session, opts: { isAppUrl: (url: string) => boolean }) {
  void loadBlocker();

  session.webRequest.onBeforeRequest((details, callback) => {
    const host = hostOf(details.url);
    if (
      !blocker ||
      !blockingEnabled ||
      opts.isAppUrl(details.url) ||
      refererHosts.has(host) ||
      NEVER_BLOCK.some((re) => re.test(host))
    ) {
      callback({});
      return;
    }
    blocker.onBeforeRequest(details, callback);
  });

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const referer = refererHosts.get(hostOf(details.url));
    if (referer) {
      const headers = { ...details.requestHeaders } as Record<string, string>;
      setHeader(headers, 'Referer', referer);
      if (details.resourceType !== 'image') setHeader(headers, 'Origin', new URL(referer).origin);
      callback({ requestHeaders: headers });
      return;
    }
    callback({});
  });

  session.webRequest.onHeadersReceived((details, callback) => {
    const streamHost = refererHosts.has(hostOf(details.url));
    // Posters, banners, episode stills and manga pages never change at the same URL, so keep
    // them on disk for a month: revisiting a page costs no data and loads instantly.
    const cacheImage = details.resourceType === 'image' && details.statusCode === 200 && !opts.isAppUrl(details.url);
    if (!streamHost && !cacheImage) {
      callback({});
      return;
    }
    const headers = { ...(details.responseHeaders ?? {}) };
    if (streamHost) {
      setHeader(headers, 'Access-Control-Allow-Origin', '*');
      setHeader(headers, 'Access-Control-Allow-Headers', '*');
      setHeader(headers, 'Access-Control-Expose-Headers', '*');
    }
    if (cacheImage) {
      setHeader(headers, 'Cache-Control', 'public, max-age=2592000, immutable');
      for (const key of Object.keys(headers)) if (/^(pragma|expires)$/i.test(key)) delete headers[key];
    }
    callback({ responseHeaders: headers });
  });
}
