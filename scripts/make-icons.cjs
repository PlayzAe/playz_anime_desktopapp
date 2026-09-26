// Renders the P seal into every image the Windows build needs:
//   build/icon.png (512), build/icon.ico (16–256), build/installerSidebar.bmp (164×314)
// Run with: npm run icons   (uses Electron's Chromium as the rasteriser, no extra deps)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build');
fs.mkdirSync(out, { recursive: true });

// Single source of truth: pull the shapes from the Logo component.
const logoSrc = fs.readFileSync(path.join(root, 'src/renderer/components/Logo.tsx'), 'utf8');
const P_PATH = /P_PATH = '([^']+)'/.exec(logoSrc)[1];
const COUNTER = /COUNTER_PATH = '([^']+)'/.exec(logoSrc)[1];
const FRAME = [...(/FRAME_PATHS = \[([^\]]+)\]/.exec(logoSrc)[1].matchAll(/'([^']+)'/g))].map((m) => m[1]);

const SHU = '#f0532c';
const CARVE = '#f6efe4';

function sealSvg(framed) {
  const frame = framed ? FRAME.map((d) => `<path d="${d}" fill="none" stroke="${CARVE}" stroke-width="2.4"/>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="9" fill="${SHU}"/>${frame}<path d="${P_PATH}${COUNTER}" fill="${CARVE}" fill-rule="evenodd"/></svg>`;
}

const fontUrl = pathToFileURL(
  path.join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2'),
).href;

const page = `<!doctype html><html><body style="margin:0;background:transparent"><canvas id="c"></canvas><script>
async function load(svg) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
}
window.render = async (framedSvg, plainSvg, sizes) => {
  const framed = await load(framedSvg);
  const plain = await load(plainSvg);
  const c = document.getElementById('c');
  const pngs = {};
  for (const size of sizes) {
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(size >= 48 ? framed : plain, 0, 0, size, size);
    pngs[size] = c.toDataURL('image/png');
  }
  return pngs;
};
window.sidebar = async (framedSvg, fontUrl) => {
  const font = new FontFace('Archivo', 'url(' + fontUrl + ')', { weight: '100 900', stretch: '62% 125%' });
  await font.load();
  document.fonts.add(font);
  const seal = await load(framedSvg);
  const c = document.getElementById('c');
  c.width = 164; c.height = 314;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0c0b0a';
  ctx.fillRect(0, 0, 164, 314);
  // A thin vermilion rule down the left edge ties the strip to the seal.
  ctx.fillStyle = '${SHU}';
  ctx.fillRect(0, 0, 4, 314);
  ctx.drawImage(seal, 26, 34, 64, 64);
  // Wordmark in condensed Archivo, sized down until it fits the strip.
  ctx.fillStyle = '#efe9e1';
  let size = 30;
  do {
    ctx.font = '800 condensed ' + size + 'px Archivo';
    size -= 1;
  } while (ctx.measureText('PlayzAnime').width > 118 && size > 12);
  ctx.fillText('PlayzAnime', 26, 138);
  ctx.fillStyle = '#8a8379';
  ctx.font = '500 12px Archivo';
  ['Watch anime.', 'Read manga.', 'Keep both', 'offline.'].forEach((line, i) => ctx.fillText(line, 26, 164 + i * 16));
  // Vertical katakana in the lower right, the same tategaki detail the app uses.
  ctx.fillStyle = '#4a4540';
  ctx.font = '600 15px "Yu Gothic UI", "Meiryo", sans-serif';
  ctx.textAlign = 'center';
  [...'プレイズアニメ'].forEach((ch, i) => ctx.fillText(ch, 140, 190 + i * 17));
  ctx.textAlign = 'start';
  const data = ctx.getImageData(0, 0, 164, 314).data;
  return Array.from(data);
};
</script></body></html>`;

function ico(pngs) {
  const sizes = Object.keys(pngs).map(Number).sort((a, b) => a - b);
  const images = sizes.map((s) => Buffer.from(pngs[s].split(',')[1], 'base64'));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const s = sizes[i];
    const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o);
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.length;
  });
  return Buffer.concat([header, dir, ...images]);
}

/** 24-bit bottom-up BMP, the format NSIS wants for installer artwork. */
function bmp(rgba, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = (h - 1 - y) * rowSize + x * 3;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(w, 18);
  header.writeInt32LE(h, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, webSecurity: false } });
  const tmp = path.join(out, '.icon-render.html');
  fs.writeFileSync(tmp, page);
  await win.loadFile(tmp);
  const framed = sealSvg(true);
  const plain = sealSvg(false);

  const pngs = await win.webContents.executeJavaScript(`render(${JSON.stringify(framed)}, ${JSON.stringify(plain)}, [16, 24, 32, 48, 64, 128, 256, 512])`);
  fs.writeFileSync(path.join(out, 'icon.png'), Buffer.from(pngs[512].split(',')[1], 'base64'));
  const { 512: _big, ...icoSizes } = pngs;
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(icoSizes));
  fs.writeFileSync(path.join(out, 'logo.svg'), framed);

  const rgba = await win.webContents.executeJavaScript(`sidebar(${JSON.stringify(framed)}, ${JSON.stringify(fontUrl)})`);
  fs.writeFileSync(path.join(out, 'installerSidebar.bmp'), bmp(rgba, 164, 314));

  fs.rmSync(tmp, { force: true });
  console.log('icons written to', out);
  app.quit();
});
