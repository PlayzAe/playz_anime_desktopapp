import { app, BrowserWindow, dialog, Menu, net, protocol, screen, session, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppCommand } from '../shared/api';
import { downloader } from './downloader';
import { accentIcon } from './appIcon';
import { applySettingsSideEffects, registerIpc } from './ipc';
import { logger } from './log';
import { installNetworkRules } from './network';
import { MEDIA_SCHEME, serveOfflineMedia } from './offline';
import { acceptProfileFromArgs } from './profiles';
import { store, type WindowState } from './store';
import { setThumbarPlayer } from './taskbar';

const log = logger('main');

const DEV_URL = process.env.PLAYZANIME_DEV_URL || '';
const APP_ORIGIN = 'app://playzanime';
const INK = '#0c0b0a';
const TITLEBAR_HEIGHT = 40;

// Frames our page may embed directly. Anything else trying to load in a
// top-level iframe (usually an ad redirect) is stopped.
const ALLOWED_FRAME_HOSTS = [/(^|\.)megaplay\.buzz$/, /(^|\.)youtube-nocookie\.com$/, /(^|\.)youtube\.com$/];

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Dev runs get their own id, so they can't claim the installed app's taskbar icon.
app.setAppUserModelId(app.isPackaged ? 'com.playzanime.desktop' : 'com.playzanime.desktop.dev');

// The portable build keeps settings and history beside the exe, so the whole app
// travels on a USB stick. PLAYZANIME_USER_DATA lets tests use a throwaway profile.
const dataOverride =
  process.env.PLAYZANIME_USER_DATA ||
  (process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PlayzAnime Data') : '');
if (dataOverride) app.setPath('userData', dataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function rendererDir() {
  return path.join(__dirname, '..', 'renderer');
}

function isAppUrl(url: string) {
  return url.startsWith(APP_ORIGIN) || (DEV_URL !== '' && url.startsWith(DEV_URL)) || url.startsWith('devtools://');
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${MEDIA_SCHEME}:`,
  `media-src 'self' blob: https: ${MEDIA_SCHEME}:`,
  "connect-src 'self' https: blob:",
  "font-src 'self' data:",
  'frame-src https:',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function serveRenderer() {
  const root = rendererDir();
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const candidate = path.normalize(path.join(root, rel));
    if (!candidate.startsWith(root)) return new Response('Not found', { status: 404 });
    const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

// ── Window placement ────────────────────────────────────────────────────────

function safeBounds(state: WindowState) {
  const { width, height } = state;
  if (state.x === undefined || state.y === undefined) return { width, height };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return state.x! + 100 < a.x + a.width && state.x! + width - 100 > a.x && state.y! >= a.y - 10 && state.y! + 60 < a.y + a.height;
  });
  return visible ? { x: state.x, y: state.y, width, height } : { width, height };
}

function trackWindowState(win: BrowserWindow) {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    const b = maximized ? store().windowState : { ...win.getNormalBounds() };
    store().windowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', save);
  win.on('unmaximize', save);
  win.on('close', save);
}

// ── Web contents hardening ──────────────────────────────────────────────────

function hostMatches(url: string, patterns: RegExp[]) {
  try {
    const host = new URL(url).host;
    return patterns.some((re) => re.test(host));
  } catch {
    return false;
  }
}

function harden(contents: WebContents) {
  // No page, ours or embedded, may open windows. External links go through IPC.
  contents.setWindowOpenHandler(({ url }) => {
    log.debug('blocked window.open', url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      log.debug('blocked navigation', url);
      event.preventDefault();
    }
  });

  contents.on('will-frame-navigate', (event) => {
    const { frame, url, isMainFrame } = event;
    if (isMainFrame || !frame) return;
    // Only police our own direct iframes; frames nested inside a player belong to that player.
    const parent = frame.parent;
    if (!parent || parent.parent) return;
    if (!hostMatches(url, ALLOWED_FRAME_HOSTS) && !url.startsWith('about:')) {
      log.debug('blocked frame navigation', url);
      event.preventDefault();
    }
  });

  contents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup();
  });

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'f11') {
      const w = BrowserWindow.fromWebContents(contents);
      if (w) w.setFullScreen(!w.isFullScreen());
      event.preventDefault();
    } else if (!app.isPackaged && (key === 'f12' || (input.control && input.shift && key === 'i'))) {
      contents.toggleDevTools();
      event.preventDefault();
    } else if ((input.control && key === 'r') || key === 'f5') {
      // A deliberate refresh fetches everything again, images included.
      contents.reloadIgnoringCache();
      event.preventDefault();
    }
  });
}

function createWindow() {
  const state = store().windowState;
  const win = new BrowserWindow({
    ...safeBounds(state),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: INK,
    title: 'PlayzAnime',
    icon: accentIcon(store().settings.accent),
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin' ? undefined : { color: INK, symbolColor: '#e9e3da', height: TITLEBAR_HEIGHT },
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow = win;
  win.setMenuBarVisibility(false);
  harden(win.webContents);
  trackWindowState(win);

  // Show on first paint, but never later than 3 s: a slow page must not look like a dead app.
  const reveal = () => {
    if (win.isDestroyed() || win.isVisible()) return;
    if (state.maximized) win.maximize();
    win.show();
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 3000);
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) log.error(`window failed to load ${url}: ${desc} (${code})`);
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('renderer gone', details.reason);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });

  // Closing mid-download would silently throw the work away, so ask first.
  let confirmedClose = false;
  win.on('close', (event) => {
    if (confirmedClose || !downloader().hasActive()) return;
    event.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: 'question',
        buttons: ['Keep downloading', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Downloads in progress',
        message: 'Downloads are still running.',
        detail: 'Quitting now stops them. Unfinished episodes and chapters can be retried from Downloads next time.',
      })
      .then(({ response }) => {
        if (response === 1) {
          confirmedClose = true;
          win.close();
        }
      });
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  void win.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);
  return win;
}

function sendCommand(command: AppCommand) {
  mainWindow?.webContents.send('app:command', command);
}

// Opening PlayzAnime again (or double-clicking a .playzanime file) focuses the running
// window instead of starting a second copy; a profile file it was given is handed over.
app.on('second-instance', (_e, argv) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void acceptProfileFromArgs(argv).then((got) => got && mainWindow?.webContents.send('profile:incoming'));
});

app.on('web-contents-created', (_e, contents) => {
  // Every page the app creates, including the hidden stream resolvers, is barred from opening windows.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  log.info(`starting ${app.getVersion()} (${DEV_URL ? `dev: ${DEV_URL}` : 'packaged'})`);
  const settings = store().settings;
  applySettingsSideEffects(settings);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
  });
  installNetworkRules(session.defaultSession, { isAppUrl });

  if (!DEV_URL) serveRenderer();
  serveOfflineMedia();
  registerIpc({
    setPlayer: (state) => {
      if (mainWindow) setThumbarPlayer(mainWindow, state, sendCommand);
    },
  });
  createWindow();
  log.info('window created');
  // Launched by double-clicking a shared profile: the page picks it up once it's ready.
  void acceptProfileFromArgs(process.argv).then((got) => got && mainWindow?.webContents.send('profile:incoming'));

  // Folder checks touch the disk (and antivirus); run them after the window is up.
  setTimeout(() => {
    store()
      .ensureDownloadDirs()
      .catch((err) => log.error('download folder check failed', err));
  }, 1500);

  // Overall download progress on the taskbar button.
  downloader().onProgress((fraction) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(fraction === null ? -1 : Math.max(0.01, fraction));
  });

  // Watchdog: if anything blocks the main thread (the cause of "Not responding"),
  // the log records how long and what the downloader was doing at that moment.
  let tick = Date.now();
  setInterval(() => {
    const lag = Date.now() - tick - 1000;
    if (lag > 700) log.warn(`main thread was blocked for ${lag} ms; downloads: ${downloader().activeSummary()}`);
    tick = Date.now();
  }, 1000).unref();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  store().flush();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
