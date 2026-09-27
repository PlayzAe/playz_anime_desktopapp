import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';
import type { AccentKey } from '../shared/types';
import { logger } from './log';

const log = logger('icon');

/*
 * The window and taskbar icon follows the accent chosen in Settings. Each accent has its
 * own pre-drawn seal in build/ (icon-shu.png and so on), packed into the app.
 */

const ACCENTS: readonly AccentKey[] = ['shu', 'yamabuki', 'matcha', 'ai', 'sakura'];
const cache = new Map<AccentKey, NativeImage>();

export function accentIcon(accent: AccentKey): NativeImage | undefined {
  const key = ACCENTS.includes(accent) ? accent : 'shu';
  const known = cache.get(key);
  if (known) return known;
  const img = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', `icon-${key}.png`));
  if (img.isEmpty()) {
    log.warn(`no icon for ${key}`);
    return undefined;
  }
  cache.set(key, img);
  return img;
}

/** Recolours every open window's icon. */
export function applyAccentIcon(accent: AccentKey) {
  const img = accentIcon(accent);
  if (!img) return;
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.setIcon(img);
}
