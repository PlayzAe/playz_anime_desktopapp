import { useEffect, useState } from 'react';
import { canGoBack, canGoForward, goBack, goForward, Link, type Route, type RouteName } from '../lib/router';
import { useApp } from '../lib/store';
import { IconButton } from './Controls';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Avatar } from './Profile';
import './shell.css';

// ── Rail ────────────────────────────────────────────────────────────────────

const NAV: { to: string; icon: IconName; label: string; match: RouteName[] }[] = [
  { to: '/', icon: 'tv', label: 'Anime', match: ['home', 'anime', 'watch'] },
  { to: '/manga', icon: 'manga', label: 'Manga', match: ['mangaHome', 'manga', 'read'] },
  { to: '/discover', icon: 'discover', label: 'Discover', match: ['discover'] },
  { to: '/schedule', icon: 'schedule', label: 'Schedule', match: ['schedule'] },
  { to: '/library', icon: 'library', label: 'Library', match: ['library'] },
  { to: '/downloads', icon: 'downloads', label: 'Downloads', match: ['downloads'] },
];

export function Rail({ route }: { route: Route }) {
  const { downloads, profile } = useApp();
  const onProfiles = route.name === 'profiles' || route.name === 'profile';
  const active = downloads.filter((d) => ['queued', 'resolving', 'downloading', 'muxing'].includes(d.state)).length;

  return (
    <nav className="rail" aria-label="Main">
      <Link to="/" className="rail-logo" aria-label="PlayzAnime home">
        <Logo size={34} />
      </Link>
      <div className="rail-items">
        {NAV.map((item) => {
          const current = item.match.includes(route.name);
          return (
            <Link key={item.to} to={item.to} className={`rail-item ${current ? 'is-current' : ''}`} aria-current={current ? 'page' : undefined} data-tip={item.label}>
              <Icon name={item.icon} size={22} />
              <span className="sr-only">{item.label}</span>
              {item.to === '/downloads' && active > 0 && <span className="rail-badge num">{active}</span>}
            </Link>
          );
        })}
      </div>
      <div className="rail-foot">
        <a
          href="https://github.com/PlayzAe"
          className="rail-item"
          data-tip="Support PlayzAnime on GitHub"
          onClick={(e) => {
            e.preventDefault();
            void window.playzanime.app.openExternal('https://github.com/PlayzAe');
          }}
        >
          <Icon name="heart" size={21} />
          <span className="sr-only">Support PlayzAnime on GitHub</span>
        </a>
        <Link to="/settings" className={`rail-item ${route.name === 'settings' ? 'is-current' : ''}`} data-tip="Settings">
          <Icon name="settings" size={22} />
          <span className="sr-only">Settings</span>
        </Link>
        <Link to="/profiles" className={`rail-item rail-profile ${onProfiles ? 'is-current' : ''}`} data-tip={profile ? `${profile.name} · Profiles` : 'Profiles'}>
          <Avatar profile={profile} size={30} own />
          <span className="sr-only">Profiles</span>
        </Link>
      </div>
    </nav>
  );
}

// ── Title bar ───────────────────────────────────────────────────────────────

export function TitleBar({ solid, onSearch, route }: { solid: boolean; onSearch: () => void; route: Route }) {
  const { downloads, online } = useApp();
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [route]);

  const running = downloads.filter((d) => ['resolving', 'downloading', 'muxing'].includes(d.state));
  const queued = downloads.filter((d) => d.state === 'queued').length;
  const overall = running.length ? running.reduce((n, d) => n + d.progress, 0) / running.length : 0;

  return (
    <header className={`titlebar ${solid ? 'is-solid' : ''}`}>
      <div className="tb-nav">
        <IconButton icon="arrowLeft" label="Back (Alt+Left)" size={18} disabled={!canGoBack()} onClick={goBack} />
        <IconButton icon="arrowRight" label="Forward (Alt+Right)" size={18} disabled={!canGoForward()} onClick={goForward} />
      </div>
      <button type="button" className="tb-search" onClick={onSearch}>
        <Icon name="search" size={16} />
        <span>Search anime and manga</span>
        <span className="tb-keys">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </button>
      <div className="tb-drag" />
      {!online && (
        <Link to="/downloads" className="tb-offline" title="No internet. Your downloads still play.">
          <Icon name="offline" size={16} />
          Offline
        </Link>
      )}
      {(running.length > 0 || queued > 0) && (
        <Link to="/downloads" className="tb-activity" title="Open downloads">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(239 233 225 / .16)" strokeWidth="2.5" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeDasharray={`${overall * 50.27} 50.27`}
              transform="rotate(-90 10 10)"
            />
          </svg>
          <span className="num">
            {running.length ? `${Math.round(overall * 100)}%` : 'Queued'}
            {queued > 0 && running.length > 0 && <span className="faint"> · {queued} waiting</span>}
          </span>
        </Link>
      )}
    </header>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────────────

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'error' ? 'is-error' : ''}`}>
          {t.tone === 'error' && <Icon name="alert" size={16} />}
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
