import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { Button } from './components/Controls';
import { ProfileDrop } from './components/ProfileDrop';
import { Rail, TitleBar, Toasts } from './components/Shell';
import { Splash } from './components/Splash';
import { UpdateNotifier } from './components/UpdateNotifier';
import { EmptyState } from './components/States';
import { goBack, goForward, navigate, useRoute, type Route } from './lib/router';
import { useApp } from './lib/store';
import { Discover } from './views/Discover';
import { Downloads } from './views/Downloads';
import { FirstRun } from './views/FirstRun';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { MangaDetail } from './views/MangaDetail';
import { MangaHome } from './views/MangaHome';
import { OfflineWatch } from './views/OfflineWatch';
import { ProfileDetail, Profiles } from './views/Profiles';
import { OfflineReader, Reader } from './views/Reader';
import { Schedule } from './views/Schedule';
import { Series } from './views/Series';
import { Settings } from './views/Settings';
import { Watch } from './views/Watch';

function View({ route }: { route: Route }): ReactNode {
  const id = Number(route.params.id);
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'mangaHome':
      return <MangaHome />;
    case 'discover':
      return <Discover />;
    case 'schedule':
      return <Schedule />;
    case 'library':
      return <Library />;
    case 'downloads':
      return <Downloads />;
    case 'settings':
      return <Settings />;
    case 'anime':
      return <Series id={id} />;
    case 'manga':
      return <MangaDetail id={id} />;
    case 'watch':
      return <Watch id={id} ep={Number(route.params.ep)} />;
    case 'read':
      return <Reader id={id} chapterId={route.params.chapter} />;
    case 'profiles':
      return <Profiles />;
    case 'profile':
      return <ProfileDetail id={route.params.id} />;
    case 'offlineWatch':
      return <OfflineWatch jobId={route.params.job} />;
    case 'offlineRead':
      return <OfflineReader jobId={route.params.job} />;
    default:
      return (
        <div className="page">
          <EmptyState
            icon="alert"
            title="This page doesn’t exist"
            body="The link may be from an older version of PlayzAnime."
            action={<Button onClick={() => navigate('/')}>Go home</Button>}
          />
        </div>
      );
  }
}

const IMMERSIVE: Route['name'][] = ['read', 'offlineRead'];
const ALWAYS_SOLID: Route['name'][] = ['watch', 'offlineWatch', 'discover', 'schedule', 'library', 'downloads', 'settings', 'profiles', 'profile'];
// Pages that manage their own query string without remounting.
const QUERY_STABLE: Route['name'][] = ['discover', 'schedule', 'library', 'read'];
// Pages that need the network; opening the app offline lands on Downloads instead.
const ONLINE_ONLY: Route['name'][] = ['home', 'mangaHome', 'discover', 'schedule', 'anime', 'manga', 'watch', 'read'];

export function App() {
  const route = useRoute();
  const { settings, online, toast } = useApp();
  // Dynamically update the desktop app and taskbar icon when the user switches accents
  useEffect(() => {
    if (!window.playzanime?.app?.setAppIcon) return;
    const accentColors: Record<string, string> = {
      shu: '#f0532c',
      matcha: '#9dbb5c',
      ai: '#6f8fe6',
      yamabuki: '#f5a623',
      sakura: '#f28baf',
    };
    const color = accentColors[settings.accent] ?? '#f0532c';
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    const svg = <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="9" fill="$color"/><path d="M40 8.5H51A4.5 4.5 0 0 1 55.5 13V44" fill="none" stroke="#f6efe4" stroke-width="2.4"/><path d="M55.5 49V51A4.5 4.5 0 0 1 51 55.5H22" fill="none" stroke="#f6efe4" stroke-width="2.4"/><path d="M16 55.5H13A4.5 4.5 0 0 1 8.5 51V13A4.5 4.5 0 0 1 13 8.5H35" fill="none" stroke="#f6efe4" stroke-width="2.4"/><path d="M17 14H35A12.5 12.5 0 0 1 35 39H27V48L17 51ZM27 20.5V32.5L38.5 26.5Z" fill="#f6efe4" fill-rule="evenodd"/></svg>;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      void window.playzanime.app.setAppIcon?.(dataUrl);
    };
  }, [settings.accent]);
  const mainRef = useRef<HTMLElement>(null);
  const scrollMemory = useRef(new Map<number, number>());
  const [scrolled, setScrolled] = useState(false);
  const [palette, setPalette] = useState(false);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  // The opening plays on every launch; first-run setup (once ever) follows it.
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    void window.playzanime.setup
      .isDone()
      .then(setSetupDone)
      .catch(() => setSetupDone(true));
  }, []);

  // Opened with no internet: go straight to what works offline. Only at launch;
  // a later disconnect keeps you where you are.
  useEffect(() => {
    if (online || !ONLINE_ONLY.includes(route.name)) return;
    navigate('/downloads', { replace: true });
    toast('You’re offline, so here are your downloads. They play without internet.');
  }, []);

  // Back/forward restores where you were; new pages start at the top.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (route.via === 'replace' && QUERY_STABLE.includes(route.name)) return;
    const saved = route.via === 'pop' ? scrollMemory.current.get(route.index) : undefined;
    el.scrollTop = saved ?? 0;
    setScrolled((saved ?? 0) > 24);
    // Images above the fold may still be loading; try once more after layout settles.
    if (saved) requestAnimationFrame(() => (el.scrollTop = saved));
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setPalette(true);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        goForward();
      }
    };
    // Mouse side buttons.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) goBack();
      if (e.button === 4) goForward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  const onScroll = () => {
    const top = mainRef.current?.scrollTop ?? 0;
    scrollMemory.current.set(route.index, top);
    setScrolled(top > 24);
  };

  const immersive = IMMERSIVE.includes(route.name);
  const viewKey = QUERY_STABLE.includes(route.name) ? route.path : `${route.path}?${route.query.toString()}`;

  return (
    <div className={`app ${immersive ? 'is-immersive' : ''}`}>
      {!immersive && <Rail route={route} />}
      {!immersive && <TitleBar route={route} solid={scrolled || ALWAYS_SOLID.includes(route.name)} onSearch={() => setPalette(true)} />}
      <main className="main" ref={mainRef} onScroll={onScroll}>
        <View key={viewKey} route={route} />
      </main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ProfileDrop />
      {!splash && setupDone === false && <FirstRun onDone={() => setSetupDone(true)} />}
      {splash && <Splash irisToRail={setupDone !== false} onDone={() => setSplash(false)} />}
      <UpdateNotifier ready={!splash} />
      <Toasts />
    </div>
  );
}
