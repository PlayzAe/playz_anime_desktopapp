import { contextBridge, ipcRenderer } from 'electron';
import type { AppCommand, PlayzAnimeApi } from '../shared/api';
import type { DownloadJob } from '../shared/types';

const call =
  <T>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>;

function listen<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_e: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: PlayzAnimeApi = {
  anilist: {
    home: call('anilist:home'),
    mangaHome: call('anilist:mangaHome'),
    browse: call('anilist:browse'),
    media: call('anilist:media'),
    schedule: call('anilist:schedule'),
  },
  episodes: {
    list: call('episodes:list'),
  },
  stream: {
    resolve: call('stream:resolve'),
  },
  manga: {
    chapters: call('manga:chapters'),
    pages: call('manga:pages'),
    health: call('manga:health'),
    extensions: call('manga:extensions'),
    toggleExtension: call('manga:toggleExtension'),
  },
  library: {
    all: call('library:all'),
    set: call('library:set'),
    remove: call('library:remove'),
  },
  history: {
    all: call('history:all'),
    save: call('history:save'),
    remove: call('history:remove'),
    clear: call('history:clear'),
    watched: call('history:watched'),
    setWatched: call('history:setWatched'),
  },
  reading: {
    all: call('reading:all'),
    save: call('reading:save'),
    remove: call('reading:remove'),
    read: call('reading:read'),
    setRead: call('reading:setRead'),
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    chooseDir: call('settings:chooseDir'),
  },
  downloads: {
    list: call('downloads:list'),
    start: call('downloads:start'),
    startMany: call('downloads:startMany'),
    cancel: call('downloads:cancel'),
    retry: call('downloads:retry'),
    remove: call('downloads:remove'),
    clearFinished: call('downloads:clearFinished'),
    open: call('downloads:open'),
    reveal: call('downloads:reveal'),
    missing: call('downloads:missing'),
    onUpdate: (listener) => listen<DownloadJob[]>('downloads:update', listener),
  },
  app: {
    info: call('app:info'),
    openExternal: call('app:openExternal'),
    openDir: call('app:openDir'),
    clearCache: call('app:clearCache'),
    setPlayer: call('app:setPlayer'),
    onCommand: (listener) => listen<AppCommand>('app:command', listener),
    online: call('app:online'),
  },
  setup: {
    isDone: call('setup:isDone'),
    status: call('setup:status'),
    allowFolders: call('setup:allowFolders'),
    complete: call('setup:complete'),
  },
  profile: {
    get: call('profile:get'),
    set: call('profile:set'),
    export: call('profile:export'),
    pick: call('profile:pick'),
    preview: call('profile:preview'),
    import: call('profile:import'),
    imported: call('profile:imported'),
    removeImported: call('profile:removeImported'),
    takePending: call('profile:takePending'),
    onIncoming: (listener) => listen<void>('profile:incoming', () => listener()),
  },
  offline: {
    items: call('offline:items'),
    pageCount: call('offline:pageCount'),
  },
};

contextBridge.exposeInMainWorld('playzanime', api);
