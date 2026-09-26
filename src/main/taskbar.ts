import { nativeImage, type BrowserWindow, type NativeImage } from 'electron';
import type { AppCommand, PlayerTaskbarState } from '../shared/api';

/*
 * Windows taskbar thumbnail buttons (prev / play-pause / next) while a video is
 * open. The glyphs are rasterised here from the same shapes as the in-app icon
 * set, so no image files ship for them.
 */

type Shape = (x: number, y: number) => boolean;

const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Shape => {
  const sign = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
};
const rect = (x0: number, y0: number, w: number, h: number): Shape => (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h;

// Shapes on the 24-unit icon grid.
const GLYPHS: Record<'play' | 'pause' | 'next' | 'prev', Shape[]> = {
  play: [tri(6.5, 4, 6.5, 20, 19.5, 12)],
  pause: [rect(6, 4.5, 4, 15), rect(14, 4.5, 4, 15)],
  next: [tri(5, 5, 5, 19, 15, 12), rect(16.5, 5, 2.5, 14)],
  prev: [tri(19, 5, 19, 19, 9, 12), rect(5, 5, 2.5, 14)],
};

function raster(shapes: Shape[], size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 24;
          const y = ((py + (sy + 0.5) / ss) / size) * 24;
          if (shapes.some((s) => s(x, y))) hits++;
        }
      }
      const a = Math.round((hits / (ss * ss)) * 255);
      const i = (py * size + px) * 4;
      // BGRA, premultiplied white.
      buf[i] = a;
      buf[i + 1] = a;
      buf[i + 2] = a;
      buf[i + 3] = a;
    }
  }
  return buf;
}

const cache = new Map<string, NativeImage>();
function icon(name: keyof typeof GLYPHS): NativeImage {
  let img = cache.get(name);
  if (!img) {
    img = nativeImage.createFromBitmap(raster(GLYPHS[name], 16), { width: 16, height: 16, scaleFactor: 1 });
    img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: raster(GLYPHS[name], 32) });
    cache.set(name, img);
  }
  return img;
}

export function setThumbarPlayer(win: BrowserWindow, state: PlayerTaskbarState | null, send: (cmd: AppCommand) => void) {
  if (process.platform !== 'win32' || win.isDestroyed()) return;
  if (!state) {
    win.setThumbarButtons([]);
    return;
  }
  win.setThumbarButtons([
    { tooltip: 'Previous episode', icon: icon('prev'), flags: state.hasPrev ? [] : ['disabled'], click: () => send('player:prev') },
    { tooltip: state.playing ? 'Pause' : 'Play', icon: icon(state.playing ? 'pause' : 'play'), click: () => send('player:toggle') },
    { tooltip: 'Next episode', icon: icon('next'), flags: state.hasNext ? [] : ['disabled'], click: () => send('player:next') },
  ]);
}
