import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Media, MediaSnapshot } from '../../shared/types';
import {
  countdown,
  formatLabel,
  isManga,
  mangaKind,
  mediaPath,
  mediaYear,
  posterOf,
  scoreLabel,
  tint,
  titleOf,
} from '../lib/format';
import { Link } from '../lib/router';
import { useApp } from '../lib/store';
import { IconButton, ProgressBar } from './Controls';
import { Icon } from './Icon';
import './media.css';

// ── Image with a colour-tinted placeholder and a quiet fade-in ──────────────

interface ImgProps {
  src?: string | null;
  alt?: string;
  color?: string | null;
  className?: string;
  eager?: boolean;
  position?: string;
}

export function Img({ src, alt = '', color, className = '', eager, position }: ImgProps) {
  // State is tied to the URL it describes. Cached images can finish loading before
  // React's effects run, so resetting state in an effect would hide a loaded picture.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={`img ${className}`} style={{ background: tint(color) }}>
      {src && failed !== src && (
        <img
          key={src}
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0 && loaded !== src) setLoaded(src);
          }}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          style={position ? { objectPosition: position } : undefined}
          className={loaded === src ? 'is-loaded' : ''}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
    </div>
  );
}

/** Library entries keep a snapshot; this turns one back into the Media shape cards expect. */
export function fromSnapshot(s: MediaSnapshot): Media {
  return {
    id: s.id,
    type: s.type,
    title: { english: s.title, romaji: s.romaji ?? s.title, native: s.native ?? null },
    coverImage: { extraLarge: s.cover, color: s.color ?? null },
    bannerImage: s.banner ?? null,
    format: s.format ?? null,
    episodes: s.episodes ?? null,
    chapters: s.chapters ?? null,
    seasonYear: s.year ?? null,
    status: s.status ?? null,
  };
}

// ── Poster card ─────────────────────────────────────────────────────────────

interface PosterProps {
  media: Media;
  /** Replaces the default meta line. */
  meta?: ReactNode;
  progress?: number;
  badge?: ReactNode;
  className?: string;
}

export function PosterCard({ media, meta, progress, badge, className = '' }: PosterProps) {
  const { settings, statusOf } = useApp();
  const title = titleOf(media, settings.titleLanguage);
  const manga = isManga(media);
  const airing = !manga && media.status === 'RELEASING' && media.nextAiringEpisode;
  const inList = statusOf(media.id);
  const kind = manga ? mangaKind(media) : formatLabel(media.format);

  return (
    <Link to={mediaPath(media)} className={`poster ${className}`} title={title}>
      <div className="poster-frame">
        <Img src={posterOf(media, settings.dataSaver)} color={media.coverImage?.color} />
        {inList && (
          <span className="poster-mark" aria-label="In your library">
            <Icon name="bookmarkFilled" size={14} />
          </span>
        )}
        {badge ??
          (airing && (
            <span className="poster-badge num">
              E{airing.episode} · {countdown(airing.timeUntilAiring)}
            </span>
          ))}
        {progress !== undefined && <ProgressBar value={progress} className="poster-progress" />}
      </div>
      <div className="poster-title clamp-2">{title}</div>
      <div className="poster-meta dot-sep">
        {meta ?? (
          <>
            {kind && <span>{kind}</span>}
            {mediaYear(media) && <span className="num">{mediaYear(media)}</span>}
            {scoreLabel(media.averageScore) && <span className="num">{scoreLabel(media.averageScore)}</span>}
          </>
        )}
      </div>
    </Link>
  );
}

export function PosterSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="poster is-skeleton" key={i} aria-hidden="true">
          <div className="poster-frame skeleton" />
          <div className="skeleton skeleton-line" style={{ width: '82%' }} />
          <div className="skeleton skeleton-line" style={{ width: '46%' }} />
        </div>
      ))}
    </>
  );
}

// ── Shelf: a titled horizontal row with arrow paging ────────────────────────

interface ShelfProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: 'posters' | 'wide' | 'ranked';
}

export function Shelf({ title, subtitle, action, children, className = '', variant = 'posters' }: ShelfProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () =>
      setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [children]);

  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className={`shelf shelf-${variant} ${className}`}>
      <header className="shelf-head">
        <div className="shelf-heading">
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="shelf-sub">{subtitle}</p>}
        </div>
        <div className="shelf-actions">
          {action}
          {!(edges.start && edges.end) && (
            <div className="shelf-nav">
              <IconButton icon="chevronLeft" label="Scroll left" disabled={edges.start} onClick={() => page(-1)} />
              <IconButton icon="chevronRight" label="Scroll right" disabled={edges.end} onClick={() => page(1)} />
            </div>
          )}
        </div>
      </header>
      <div className={`shelf-track ${edges.start ? '' : 'fade-start'} ${edges.end ? '' : 'fade-end'}`} ref={track}>
        {children}
      </div>
    </section>
  );
}
