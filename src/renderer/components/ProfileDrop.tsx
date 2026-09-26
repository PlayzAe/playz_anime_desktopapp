import { useEffect, useRef, useState } from 'react';
import type { ImportedProfile, ProfileExport } from '../../shared/types';
import { navigate } from '../lib/router';
import { useApp } from '../lib/store';
import { Button } from './Controls';
import { Icon } from './Icon';
import { Avatar } from './Profile';
import './profiledrop.css';

/*
 * Drop a friend's .playzanime file anywhere in the app. Their seal is stamped
 * in, their lists are counted up, and they land in Profiles, kept apart from
 * your own library.
 */

const EVENT = 'playzanime:import-profile';

/** Lets the Profiles page's Import button reuse the same animation. */
export function startProfileImport(text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
}

type State =
  | { stage: 'idle' }
  | { stage: 'hover' }
  | { stage: 'importing'; data: ProfileExport }
  | { stage: 'done'; data: ProfileExport; saved: ImportedProfile };

const STAMP_MS = 1700;

function possessive(name: string) {
  return name.endsWith('s') ? `${name}’` : `${name}’s`;
}

export function ProfileDrop() {
  const { toast, refreshImported } = useApp();
  const [state, setState] = useState<State>({ stage: 'idle' });
  const depth = useRef(0);
  const busy = state.stage === 'importing';

  const run = async (text: string) => {
    let data: ProfileExport;
    try {
      data = await window.playzanime.profile.preview(text);
    } catch (err) {
      setState({ stage: 'idle' });
      toast(err instanceof Error ? err.message : 'That file isn’t a PlayzAnime profile.', { tone: 'error' });
      return;
    }
    setState({ stage: 'importing', data });
    const [saved] = await Promise.all([window.playzanime.profile.import(text), new Promise((r) => setTimeout(r, STAMP_MS))]);
    await refreshImported();
    setState({ stage: 'done', data, saved: saved as ImportedProfile });
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setState((s) => (s.stage === 'idle' ? { stage: 'hover' } : s));
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setState((s) => (s.stage === 'hover' ? { stage: 'idle' } : s));
    };
    const drop = (e: DragEvent) => {
      // Never let a dropped file replace the app page.
      e.preventDefault();
      depth.current = 0;
      const file = e.dataTransfer?.files?.[0];
      if (!file) {
        setState((s) => (s.stage === 'hover' ? { stage: 'idle' } : s));
        return;
      }
      if (!/\.(playzanime|json)$/i.test(file.name)) {
        setState({ stage: 'idle' });
        toast('Drop a .playzanime profile file to import a friend’s lists.');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setState({ stage: 'idle' });
        toast('That file is too large to be a PlayzAnime profile.', { tone: 'error' });
        return;
      }
      void file.text().then((t) => runRef.current(t));
    };
    const external = (e: Event) => void runRef.current(String((e as CustomEvent<string>).detail ?? ''));
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener(EVENT, external);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener(EVENT, external);
    };
  }, [toast]);

  // A .playzanime file double-clicked in Explorer arrives through the main process.
  useEffect(() => {
    const take = () =>
      void window.playzanime.profile.takePending().then((text) => {
        if (text) void runRef.current(text);
      });
    take();
    return window.playzanime.profile.onIncoming(take);
  }, []);

  useEffect(() => {
    if (state.stage !== 'done') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ stage: 'idle' });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.stage]);

  if (state.stage === 'idle') return null;

  if (state.stage === 'hover') {
    return (
      <div className="pdrop is-hover" aria-live="polite">
        <div className="pdrop-target">
          <Icon name="profiles" size={34} />
          <strong>Drop to import a profile</strong>
          <span>Their lists go into Profiles. Your own library isn’t touched.</span>
        </div>
      </div>
    );
  }

  const { data } = state;
  const p = data.profile;
  const watchedEpisodes = data.history.length;
  return (
    <div className={`pdrop is-${state.stage}`} role="dialog" aria-modal="true" aria-label={`Importing ${possessive(p.name)} profile`}>
      <div className="pdrop-card">
        <div className="pdrop-stamp">
          <Avatar profile={p} size={96} />
          <span className="pdrop-ripple" />
        </div>
        <div className="pdrop-eyebrow">{busy ? 'Importing' : 'Imported'}</div>
        <h2 className="pdrop-name display">{busy ? `${possessive(p.name)} data` : p.name}</h2>
        {p.tagline && <p className="pdrop-tagline">“{p.tagline}”</p>}
        <dl className="pdrop-counts">
          <Count label="in their library" value={data.library.length} animate={busy} />
          <Count label={watchedEpisodes === 1 ? 'show watched' : 'shows watched'} value={watchedEpisodes} animate={busy} />
          <Count label="series read" value={data.reading.length} animate={busy} />
          <Count label="favourites" value={p.favorites.length} animate={busy} />
        </dl>
        <div className="pdrop-bar">
          <span />
        </div>
        {state.stage === 'done' && (
          <div className="pdrop-actions">
            <Button
              variant="primary"
              icon="profile"
              onClick={() => {
                setState({ stage: 'idle' });
                navigate(`/profiles/${encodeURIComponent(state.saved.profile.id)}`);
              }}
            >
              View profile
            </Button>
            <Button variant="ghost" onClick={() => setState({ stage: 'idle' })}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Count({ label, value, animate }: { label: string; value: number; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : value);
  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (STAMP_MS - 300));
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, animate]);
  return (
    <div className="pdrop-count">
      <dt className="num">{shown}</dt>
      <dd>{label}</dd>
    </div>
  );
}
