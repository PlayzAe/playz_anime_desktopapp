import { app, BrowserWindow, nativeImage, shell, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AccentKey } from '../shared/types';
import { logger } from './log';

const log = logger('icon');

/*
 * The window and taskbar icon follows the accent chosen in Settings. Each accent has its
 * own pre-drawn seal in build/ (icon-shu.png and so on), packed into the app.
 */

/** Dev runs get their own id, so they can't claim the installed app's taskbar icon. */
export const APP_ID = app.isPackaged ? 'com.playzanime.desktop' : 'com.playzanime.desktop.dev';

const ACCENTS: readonly AccentKey[] = ['shu', 'yamabuki', 'matcha', 'ai', 'sakura'];
const cache = new Map<AccentKey, NativeImage>();
const known = (accent: AccentKey): AccentKey => (ACCENTS.includes(accent) ? accent : 'shu');

export function accentIcon(accent: AccentKey): NativeImage | undefined {
  const key = known(accent);
  const hit = cache.get(key);
  if (hit) return hit;
  const img = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', `icon-${key}.png`));
  if (img.isEmpty()) {
    log.warn(`no icon for ${key}`);
    return undefined;
  }
  cache.set(key, img);
  return img;
}

/** An .ico holding the seal at the sizes Windows asks for, each stored as PNG. */
function toIco(img: NativeImage): Buffer {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, at); // 0 means 256
    head.writeUInt8(s >= 256 ? 0 : s, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(pngs[i].length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}

/** Windows reads the taskbar icon from a file on disk, so each accent's seal is written once. */
function icoFile(accent: AccentKey): string | undefined {
  const key = known(accent);
  const file = path.join(app.getPath('userData'), 'icons', `${key}.ico`);
  if (fs.existsSync(file)) return file;
  const img = accentIcon(key);
  if (!img) return undefined;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, toIco(img));
    return file;
  } catch (err) {
    log.warn(`couldn't write ${file}:`, String(err));
    return undefined;
  }
}

/**
 * The taskbar button of an installed app takes its icon from the app's Start menu shortcut,
 * whatever the window says, so the installer's shortcuts (Start menu and desktop) are pointed
 * at the accent's icon too. Only shortcuts that open this very exe are touched.
 */
function updateShortcuts(ico: string, exe: string) {
  const places = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop')];
  for (const dir of places) {
    const link = path.join(dir, 'PlayzAnime.lnk');
    try {
      if (!fs.existsSync(link)) continue;
      const current = shell.readShortcutLink(link);
      if (current.target.toLowerCase() !== exe.toLowerCase() || current.icon === ico) continue;
      shell.writeShortcutLink(link, 'update', { target: current.target, icon: ico, iconIndex: 0 });
    } catch (err) {
      log.warn(`couldn't update ${link}:`, String(err));
    }
  }
}

/** Recolours the window icon and, on Windows, the taskbar button and the app's shortcuts. */
export function applyAccentIcon(accent: AccentKey, windows = BrowserWindow.getAllWindows()) {
  const img = accentIcon(accent);
  if (!img) return;
  const ico = process.platform === 'win32' ? icoFile(accent) : undefined;
  // The portable build runs from a temporary copy; relaunching should use the real file.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  if (ico && app.isPackaged) updateShortcuts(ico, exe);
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    win.setIcon(img);
    if (ico) win.setAppDetails({ appId: APP_ID, appIconPath: ico, appIconIndex: 0, relaunchCommand: `"${exe}"`, relaunchDisplayName: 'PlayzAnime' });
  }
}
