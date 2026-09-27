import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import './update.css';

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

const GITHUB_REPO = 'PlayzAe/playz_anime_desktopapp';
const DISMISSED_KEY = 'playzanime:dismissed_update';

function compareVersions(remote: string, current: string): boolean {
  const r = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const c = current.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] ?? 0;
    const cv = c[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

export function UpdateNotifier({ ready }: { ready: boolean }) {
  const [update, setUpdate] = useState<GithubRelease | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!ready) return;

    // Wait 2.5 seconds after splash/animation completes
    const timer = setTimeout(async () => {
      try {
        const info = await window.playzanime.app.info().catch(() => ({ version: '1.1.0' }));
        const currentVersion = info?.version || '1.1.0';

        // Completely unauthenticated public GitHub REST API - NO KEYS REQUIRED
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'PlayzAnime-Client',
          },
        });

        if (!res.ok) return;
        const data = (await res.json()) as GithubRelease;
        if (!data?.tag_name) return;

        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (dismissed === data.tag_name) return;

        const isNewer = compareVersions(data.tag_name, currentVersion);
        if (isNewer) {
          setUpdate(data);
        }
      } catch {
        // Silently skip if offline or rate limited
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [ready]);

  const handleDismiss = () => {
    if (update) {
      try {
        localStorage.setItem(DISMISSED_KEY, update.tag_name);
      } catch {}
    }
    setClosed(true);
  };

  const handleOpen = () => {
    if (update) {
      void window.playzanime.app.openExternal(update.html_url);
      handleDismiss();
    }
  };

  if (!update || closed) return null;

  // Clean first couple lines of changelog
  const summaryLines = (update.body || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
    .slice(0, 2);

  return (
    <AnimatePresence>
      <motion.div
        className="update-toast"
        role="alert"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="update-toast-glow" />
        <div className="update-toast-content">
          <div className="update-toast-header">
            <div className="update-badge">
              <span className="update-pulse-dot" />
              <span>Yoo, new update is out!</span>
            </div>
            <button type="button" className="update-close-btn" onClick={handleDismiss} title="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>

          <div className="update-title">
            PlayzAnime <strong>{update.tag_name}</strong> is available
          </div>

          {summaryLines.length > 0 ? (
            <ul className="update-highlights">
              {summaryLines.map((line, i) => (
                <li key={i}>{line.replace(/^[-*•]\s*/, '')}</li>
              ))}
            </ul>
          ) : (
            <p className="update-body">New features, performance enhancements, and source fixes are ready.</p>
          )}

          <div className="update-actions">
            <button type="button" className="update-download-btn" onClick={handleOpen}>
              <Icon name="downloads" size={14} />
              <span>Download Latest Release</span>
            </button>
            <button type="button" className="update-later-btn" onClick={handleDismiss}>
              Later
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
