import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CHANGELOG_URL, DESKTOP_REPO } from '../lib/links';
import { Button } from './Controls';
import { Icon } from './Icon';
import './update.css';

/*
 * A new Windows release, announced once. In the Windows app it means "update available";
 * on the web it tells visitors the app has something new. Release notes are written on
 * GitHub, so there's nothing to change here when one comes out.
 */

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
}

const DISMISSED_KEY = 'playzanime:dismissed_update';

/** True when `remote` is a higher version than `current` (both like v1.2.3). */
function isNewer(remote: string, current: string): boolean {
  const r = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const c = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    if ((r[i] ?? 0) !== (c[i] ?? 0)) return (r[i] ?? 0) > (c[i] ?? 0);
  }
  return false;
}

/** The first couple of top-level points from the notes, as plain text. */
function highlights(body: string, count = 2): string[] {
  const plain = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, '')
      .replace(/:$/, '')
      .trim();
  const lines = body.split(/\r?\n/);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l)).map((l) => plain(l.replace(/^[-*•]\s+/, '')));
  const pick = bullets.length ? bullets : lines.filter((l) => l.trim() && !/^\s*#/.test(l)).map(plain);
  return pick.filter(Boolean).slice(0, count);
}

export function UpdateNotifier({ ready }: { ready: boolean }) {
  const [update, setUpdate] = useState<GithubRelease | null>(null);
  const [web, setWeb] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!ready) return;
    // Give the intro and the first screen a moment before saying anything.
    const timer = setTimeout(async () => {
      try {
        const info = await window.playzanime.app.info();
        const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) return;
        const latest = (await res.json()) as GithubRelease;
        if (!latest?.tag_name) return;
        try {
          if (localStorage.getItem(DISMISSED_KEY) === latest.tag_name) return;
        } catch {
          /* storage unavailable */
        }
        const onWeb = info.platform === 'web';
        // The web app has no version of its own to compare, so it announces each release once.
        if (onWeb || isNewer(latest.tag_name, info.version)) {
          setWeb(onWeb);
          setUpdate(latest);
        }
      } catch {
        // Offline or rate-limited: try again next launch.
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [ready]);

  const dismiss = () => {
    try {
      if (update) localStorage.setItem(DISMISSED_KEY, update.tag_name);
    } catch {
      /* storage unavailable */
    }
    setClosed(true);
  };

  const go = (url: string) => {
    void window.playzanime.app.openExternal(url);
    dismiss();
  };

  const points = update ? highlights(update.body ?? '') : [];

  return (
    <AnimatePresence>
      {update && !closed && (
        <motion.aside
          className="update-toast"
          role="status"
          aria-label={web ? 'New Windows release' : 'Update available'}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="update-head">
            <span className="update-eyebrow">{web ? 'New for Windows' : 'Update available'}</span>
            <button type="button" className="update-close" onClick={dismiss} aria-label="Dismiss">
              <Icon name="close" size={15} />
            </button>
          </div>
          <p className="update-title">
            PlayzAnime <span className="update-version num">{update.tag_name}</span> {web ? 'is out' : 'is ready to download'}
          </p>
          {points.length > 0 && (
            <ul className="update-points">
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="update-actions">
            <Button variant="primary" size="sm" icon="downloads" onClick={() => go(update.html_url)}>
              {web ? 'Get the Windows app' : 'Download'}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => go(CHANGELOG_URL)}>
              What’s new
            </Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
