import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Profile, SetupStatus } from '../../shared/types';
import { Button } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { blankProfile, ProfileFields } from '../components/Profile';
import { Aurora } from '../components/Splash';
import { useApp } from '../lib/store';
import './firstrun.css';

/*
 * Shown once ever, right after the opening Splash on the very first launch
 * (`start.bat setup` shows it again). The slow one-off work happens in the open
 * (folders, Windows folder protection, the first catalogue fetch), anything that
 * needs a decision is asked, and a profile can be set up. Tinted by the accent.
 */

const api = () => window.playzanime;
const EASE = [0.2, 0.8, 0.2, 1] as const;

type StepState = 'wait' | 'run' | 'done' | 'warn';
type StepKey = 'folders' | 'guard' | 'catalogue';
type Phase = 'prepare' | 'protect' | 'profile' | 'leaving';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'folders', label: 'Making your PlayzAnime and PlayzManga folders' },
  { key: 'guard', label: 'Checking Windows folder protection' },
  { key: 'catalogue', label: 'Fetching this season’s catalogue' },
];

const MIN_PREPARE_MS = 3200;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const stage = {
  initial: { opacity: 0, y: 28, filter: 'blur(12px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE } },
  exit: { opacity: 0, y: -22, filter: 'blur(10px)', transition: { duration: 0.35, ease: 'easeIn' as const } },
};

export function FirstRun({ onDone }: { onDone: () => void }) {
  const { profile, saveProfile, toast } = useApp();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('prepare');
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({ folders: 'run', guard: 'wait', catalogue: 'wait' });
  const [notes, setNotes] = useState<Partial<Record<StepKey, string>>>({});
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [draft, setDraft] = useState<Profile>(() => profile ?? blankProfile());
  const started = useRef(false);

  const mark = (key: StepKey, state: StepState, note?: string) => {
    setSteps((s) => ({ ...s, [key]: state }));
    if (note) setNotes((n) => ({ ...n, [key]: note }));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t0 = Date.now();
    void (async () => {
      let s: SetupStatus | null = null;
      try {
        s = await api().setup.status();
      } catch {
        /* reported as a folder warning */
      }
      setStatus(s);
      const moved = s?.folderIssues.length ? s.folderIssues : null;
      mark('folders', !s || moved ? 'warn' : 'done', !s ? 'Couldn’t check the folders' : moved ? 'Using your Downloads folder for now' : undefined);

      mark('guard', 'run');
      await new Promise((r) => setTimeout(r, 600));
      if (s?.guard === 'on') mark('guard', moved ? 'warn' : 'done', 'Controlled folder access is on');
      else mark('guard', 'done', s?.guard === 'audit' ? 'Audit mode only: nothing is blocked' : undefined);

      mark('catalogue', 'run');
      if (s && !s.online) mark('catalogue', 'warn', 'You’re offline. It loads when you reconnect.');
      else {
        const feed = await withTimeout(Promise.all([api().anilist.home(), api().anilist.mangaHome()]).catch(() => null), 25_000);
        mark('catalogue', feed ? 'done' : 'warn', feed ? undefined : 'Slow connection. It will finish in the background.');
      }

      const wait = MIN_PREPARE_MS - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setPhase(s?.folderIssues.length ? 'protect' : 'profile');
    })();
  }, []);

  const allow = async () => {
    setAllowing(true);
    try {
      const { approved, status: next } = await api().setup.allowFolders();
      setStatus(next);
      if (!approved) toast('Windows didn’t allow it. Downloads will keep using your Downloads folder.');
      else if (next.folderIssues.length) toast('Still blocked. Downloads will keep using your Downloads folder.', { tone: 'error' });
      else {
        toast('PlayzAnime can now save to your Desktop folders.');
        setPhase('profile');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That didn’t work.', { tone: 'error' });
    } finally {
      setAllowing(false);
    }
  };

  const finish = async (withProfile: boolean) => {
    if (withProfile) {
      if (!draft.name.trim()) {
        toast('Add a name first, or skip for now.');
        return;
      }
      await saveProfile({ ...draft, name: draft.name.trim() });
    }
    await api().setup.complete();
    setPhase('leaving');
    window.setTimeout(onDone, reduced ? 200 : 900);
  };

  const guardOn = status?.guard === 'on';
  const doneCount = Object.values(steps).filter((s) => s === 'done' || s === 'warn').length;

  return (
    <motion.div
      className="firstrun"
      role="dialog"
      aria-modal="true"
      aria-label="Setting up PlayzAnime"
      initial={false}
      // Leaving: an iris closes onto the seal in the sidebar, where the app takes over.
      animate={phase === 'leaving' ? { clipPath: 'circle(0px at 34px 32px)' } : { clipPath: 'circle(150% at 34px 32px)' }}
      transition={{ duration: phase === 'leaving' ? 0.85 : 0, ease: [0.7, 0, 0.84, 0] }}
    >
      <Aurora />
      <div className="fr-drag" />

      <div className="fr-brand">
        <span className="fr-brand-seal">
          <Logo size={30} />
        </span>
        <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
          PlayzAnime
        </motion.span>
      </div>

      {/* popLayout: the next stage arrives while the last one leaves, so there's never an empty frame. */}
      <AnimatePresence mode="popLayout">
        {phase === 'prepare' && (
          <motion.div key="prepare" className="fr-stage fr-prepare" {...stage}>
            {/* The seal from the opening, resting in its light. No spinner: the steps show progress. */}
            <motion.div className="fr-ring-wrap" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 18, delay: 0.1 }}>
              <span className="fr-halo" aria-hidden="true" />
              <span className="fr-seal">
                <Logo size={148} />
              </span>
            </motion.div>
            <div className="fr-copy">
              <Words text="Getting things ready" className="fr-title display" delay={0.15} />
              <motion.p className="fr-sub" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}>
                One-time setup. It usually takes under a minute, and you won’t see this screen again.
              </motion.p>
              <ol className="fr-steps">
                {STEPS.map((s, i) => (
                  <motion.li
                    key={s.key}
                    className={`fr-step is-${steps[s.key]}`}
                    initial={{ opacity: 0, x: -24 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.65 + i * 0.12, type: 'spring', stiffness: 260, damping: 24 }}
                  >
                    <StepMark state={steps[s.key]} />
                    <span className="fr-step-text">
                      {s.label}
                      <AnimatePresence>
                        {notes[s.key] && (
                          <motion.span className="fr-step-note" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                            {notes[s.key]}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </motion.li>
                ))}
              </ol>
            </div>
          </motion.div>
        )}

        {phase === 'protect' && status && (
          <motion.div key="protect" className="fr-stage fr-card" {...stage}>
            <span className="fr-card-icon">
              <span className="fr-pulse" aria-hidden="true" />
              <Icon name="shield" size={26} />
            </span>
            <Words text={guardOn ? 'Windows is guarding your Desktop' : 'That folder isn’t writable'} className="fr-title display" />
            {guardOn ? (
              <p className="fr-sub">
                <b>Controlled folder access</b> is on, so Windows stops new apps from saving to Desktop, Documents and Videos. PlayzAnime can ask Windows to let it in;
                you’ll see an admin prompt. Or keep downloads in your Downloads folder, which Windows leaves open.
              </p>
            ) : (
              <p className="fr-sub">PlayzAnime couldn’t save to the folder below, so downloads will go to your Downloads folder. You can pick another folder any time from Downloads.</p>
            )}
            <ul className="fr-paths">
              {status.folderIssues.map((i, n) => (
                <motion.li key={i.kind} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + n * 0.1 }}>
                  <span className="fr-path-kind">{i.kind === 'anime' ? 'Anime' : 'Manga'}</span>
                  <span className="fr-path is-blocked" title={i.wanted}>
                    {i.wanted}
                  </span>
                  <Icon name="arrowRight" size={14} />
                  <span className="fr-path" title={i.usedInstead}>
                    {i.usedInstead}
                  </span>
                </motion.li>
              ))}
            </ul>
            <div className="fr-actions">
              {guardOn && (
                <Button variant="primary" size="lg" icon="shield" className="fr-cta" disabled={allowing} onClick={() => void allow()}>
                  {allowing ? 'Waiting for Windows…' : 'Allow PlayzAnime'}
                </Button>
              )}
              <Button variant={guardOn ? 'ghost' : 'primary'} size="lg" disabled={allowing} onClick={() => setPhase('profile')}>
                {guardOn ? 'Use Downloads instead' : 'Continue'}
              </Button>
            </div>
            {guardOn && (
              <p className="fr-fine">
                Prefer to do it yourself? Windows Security → Virus &amp; threat protection → Ransomware protection → Allow an app through Controlled folder access,
                then add PlayzAnime.
              </p>
            )}
          </motion.div>
        )}

        {(phase === 'profile' || phase === 'leaving') && (
          <motion.div key="profile" className="fr-stage fr-card fr-profile" {...stage}>
            <Words text={profile ? 'Still you?' : 'Make it yours'} className="fr-title display" />
            <motion.p className="fr-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
              A name, a picture and your favourites. It stays on this computer; share it with friends as a file whenever you like.
            </motion.p>
            <ProfileFields value={draft} onChange={setDraft} />
            <div className="fr-actions">
              <Button variant="primary" size="lg" className="fr-cta" onClick={() => void finish(true)}>
                Save and start watching
              </Button>
              <Button variant="ghost" size="lg" onClick={() => void finish(false)}>
                Skip for now
              </Button>
            </div>
            <p className="fr-fine">You can change this later from Profiles in the sidebar.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fr-progress" aria-hidden="true">
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: phase === 'prepare' ? doneCount / (STEPS.length + 1) : phase === 'protect' ? 0.8 : 1 }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
        />
      </div>
    </motion.div>
  );
}

function Words({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <h1 className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          className="fr-word"
          aria-hidden="true"
          initial={{ opacity: 0, y: '0.55em', filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: delay + i * 0.08, duration: 0.6, ease: EASE }}
        >
          {w}
        </motion.span>
      ))}
    </h1>
  );
}

function StepMark({ state }: { state: StepState }) {
  return (
    <span className={`fr-step-mark is-${state}`} aria-hidden="true">
      <AnimatePresence mode="wait" initial={false}>
        {state === 'run' && (
          <motion.span key="run" className="fr-spin" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1, rotate: 360 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ rotate: { repeat: Infinity, duration: 0.8, ease: 'linear' } }} />
        )}
        {state === 'done' && (
          <motion.svg key="done" viewBox="0 0 24 24" width="14" height="14" initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 16 }}>
            <motion.path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="square" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} />
          </motion.svg>
        )}
        {state === 'warn' && (
          <motion.span key="warn" initial={{ scale: 0.3 }} animate={{ scale: 1, x: [0, -3, 3, -2, 0] }} transition={{ duration: 0.4 }}>
            <Icon name="alert" size={14} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
