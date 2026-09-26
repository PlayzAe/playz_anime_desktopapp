import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { Logo } from './Logo';
import './splash.css';

/*
 * The opening every time PlayzAnime starts: ink bleeds out, the seal is stamped
 * (the screen jolts), the name writes itself in, then an iris closes onto the seal
 * in the sidebar where the app takes over. It's tinted by the chosen accent, and
 * the app loads underneath the whole time, so it costs no waiting. A click or any
 * key skips it.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;
const HOLD_MS = 2100;

export function Splash({ onDone, irisToRail = true }: { onDone: () => void; irisToRail?: boolean }) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), reduced ? 500 : HOLD_MS);
    const skip = () => setLeaving(true);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', skip);
    };
  }, [reduced]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDone, reduced ? 150 : 700);
    return () => window.clearTimeout(t);
  }, [leaving]);

  const drops = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.3;
        const r = 110 + ((i * 37) % 70);
        return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: 4 + ((i * 7) % 9) };
      }),
    [],
  );

  const exit = irisToRail ? { clipPath: 'circle(0px at 34px 32px)' } : { opacity: 0, scale: 1.04, filter: 'blur(6px)' };

  return (
    <motion.div
      className="splash"
      aria-hidden="true"
      onClick={() => setLeaving(true)}
      initial={{ clipPath: 'circle(150% at 34px 32px)', opacity: 1 }}
      animate={leaving ? exit : { clipPath: 'circle(150% at 34px 32px)' }}
      transition={{ duration: leaving ? (reduced ? 0.15 : 0.65) : 0, ease: [0.7, 0, 0.84, 0] }}
    >
      <Aurora />
      <motion.div className="splash-center" animate={reduced ? undefined : { x: [0, 0, -7, 6, -3, 0] }} transition={{ duration: 0.42, delay: 0.38, times: [0, 0.01, 0.25, 0.5, 0.75, 1] }}>
        {!reduced && (
          <>
            <motion.span className="splash-ink" initial={{ scale: 0, opacity: 0.85 }} animate={{ scale: 9, opacity: 0 }} transition={{ delay: 0.42, duration: 1.6, ease: 'easeOut' }} />
            {[0, 1].map((i) => (
              <motion.span key={i} className="splash-shock" initial={{ scale: 0.5, opacity: 0.9 }} animate={{ scale: 2.6 + i, opacity: 0 }} transition={{ delay: 0.42 + i * 0.12, duration: 0.9, ease: 'easeOut' }} />
            ))}
            {drops.map((d, i) => (
              <motion.span
                key={i}
                className="splash-drop"
                style={{ width: d.s, height: d.s }}
                initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
                animate={{ x: d.x, y: d.y, scale: [0, 1, 0.5], opacity: [0, 1, 0] }}
                transition={{ delay: 0.44, duration: 0.9, ease: 'easeOut' }}
              />
            ))}
          </>
        )}
        <motion.div
          className="splash-stamp"
          initial={reduced ? { opacity: 0 } : { scale: 2.8, rotate: -16, opacity: 0, filter: 'blur(8px)' }}
          animate={{ scale: 1, rotate: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 520, damping: 20, mass: 1.2, delay: 0.1 }}
        >
          <Logo size={120} />
        </motion.div>
        <div className="splash-word display" aria-label="PlayzAnime">
          {'PlayzAnime'.split('').map((c, i) => (
            <motion.span key={i} initial={{ opacity: 0, y: 26, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: reduced ? 0 : 0.8 + i * 0.045, duration: 0.55, ease: EASE }}>
              {c}
            </motion.span>
          ))}
        </div>
        <motion.div className="splash-tag" initial={{ opacity: 0, letterSpacing: '0.9em' }} animate={{ opacity: 1, letterSpacing: '0.4em' }} transition={{ delay: reduced ? 0 : 1.3, duration: 0.9, ease: EASE }}>
          アニメ ・ マンガ
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/** Slow accent light, film grain and a few kana drifting up. Also the backdrop of first-run setup. */
export function Aurora() {
  const glyphs = useMemo(
    () => '朱印アニメ漫画夜桜月藍抹茶山吹'.split('').map((g, i) => ({ g, left: (i * 61) % 100, dur: 22 + ((i * 13) % 18), delay: -((i * 7) % 30), size: 14 + ((i * 5) % 22) })),
    [],
  );
  return (
    <div className="aurora" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`aurora-blob b${i}`}
          animate={{ x: [0, 80 - i * 40, -50 + i * 20, 0], y: [0, -50 + i * 30, 40, 0], scale: [1, 1.18, 0.92, 1] }}
          transition={{ duration: 20 + i * 5, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {glyphs.map((x, i) => (
        <span key={i} className="aurora-glyph" style={{ left: `${x.left}%`, fontSize: x.size, animationDuration: `${x.dur}s`, animationDelay: `${x.delay}s` }}>
          {x.g}
        </span>
      ))}
      <span className="aurora-grain" />
    </div>
  );
}
