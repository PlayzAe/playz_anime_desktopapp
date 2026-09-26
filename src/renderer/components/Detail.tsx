import { useState, type ReactNode } from 'react';
import type { MediaDetail } from '../../shared/types';
import {
  altTitleOf,
  countdown,
  coverOf,
  formatLabel,
  isManga,
  mangaKind,
  plainText,
  scoreLabel,
  seasonLabel,
  statusLabel,
  tint,
  titleOf,
} from '../lib/format';
import { Link, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import { Img, PosterCard } from './Media';
import { EmptyState } from './States';
import './detail.css';

// ── Header ──────────────────────────────────────────────────────────────────

export function DetailHeader({ media, actions, kicker }: { media: MediaDetail; actions: ReactNode; kicker?: ReactNode }) {
  const { settings } = useApp();
  const [expanded, setExpanded] = useState(false);
  const title = titleOf(media, settings.titleLanguage);
  const alt = altTitleOf(media, settings.titleLanguage);
  const description = plainText(media.description);
  const manga = isManga(media);
  const banner = media.bannerImage;

  return (
    <header className="detail-head" style={{ ['--tint' as string]: tint(media.coverImage?.color, 0.34) }}>
      <div className={`detail-backdrop ${banner ? '' : 'is-cover'}`}>
        <Img src={banner || coverOf(media)} color={media.coverImage?.color} eager position="center 30%" />
      </div>
      <div className="detail-grid">
        <div className="detail-poster">
          <Img src={coverOf(media)} color={media.coverImage?.color} eager />
        </div>
        <div className="detail-info">
          <div className="detail-kicker dot-sep">
            {kicker}
            <span>{manga ? mangaKind(media) : formatLabel(media.format)}</span>
            {seasonLabel(media) && <span>{manga ? media.startDate?.year : seasonLabel(media)}</span>}
            {statusLabel(media.status) && <span>{statusLabel(media.status)}</span>}
          </div>
          <h1 className="detail-title display">{title}</h1>
          {alt && <p className="detail-alt">{alt}</p>}
          {media.genres?.length ? (
            <p className="detail-genres">
              {media.genres.map((g, i) => (
                <span key={g}>
                  {i > 0 && <span className="detail-genre-sep">/</span>}
                  <Link to={withQuery('/discover', { type: manga ? 'MANGA' : null, genre: g })}>{g}</Link>
                </span>
              ))}
            </p>
          ) : null}
          <div className="detail-actions">{actions}</div>
          {description && (
            <div className={`detail-desc ${expanded ? 'is-open' : ''}`}>
              <p className={expanded ? '' : 'clamp-3'}>{description}</p>
              {description.length > 260 && (
                <button type="button" className="detail-more" onClick={() => setExpanded(!expanded)}>
                  {expanded ? 'Less' : 'More'}
                </button>
              )}
            </div>
          )}
        </div>
        {settings.showNativeTitles && media.title.native && (
          <div className="detail-native jp" aria-hidden="true">
            {media.title.native}
          </div>
        )}
      </div>
    </header>
  );
}

// ── Facts aside ─────────────────────────────────────────────────────────────

function fuzzyDate(d?: { year?: number | null; month?: number | null; day?: number | null } | null) {
  if (!d?.year) return null;
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day ?? 1).toLocaleDateString(undefined, { day: d.day ? 'numeric' : undefined, month: 'short', year: 'numeric' });
}

const SOURCE: Record<string, string> = {
  ORIGINAL: 'Original',
  MANGA: 'Manga',
  LIGHT_NOVEL: 'Light novel',
  WEB_NOVEL: 'Web novel',
  NOVEL: 'Novel',
  VISUAL_NOVEL: 'Visual novel',
  VIDEO_GAME: 'Video game',
  WEB_MANGA: 'Web manga',
  MANHWA: 'Manhwa',
  OTHER: 'Other',
};

export function DetailFacts({ media, children }: { media: MediaDetail; children?: ReactNode }) {
  const manga = isManga(media);
  const start = fuzzyDate(media.startDate);
  const end = fuzzyDate(media.endDate);
  const rank = media.rankings?.find((r) => r.type === 'RATED' && r.allTime) ?? media.rankings?.find((r) => r.type === 'POPULAR' && r.allTime);
  const authors = media.staff?.edges.filter((e) => /story|art|original/i.test(e.role)).map((e) => e.node.name.full);
  const facts: [string, ReactNode][] = [
    ['Format', manga ? mangaKind(media) : formatLabel(media.format)],
    manga ? ['Chapters', media.chapters ?? (media.status === 'RELEASING' ? 'Ongoing' : null)] : ['Episodes', media.episodes ?? (media.nextAiringEpisode ? `${media.nextAiringEpisode.episode - 1} so far` : null)],
    manga ? ['Volumes', media.volumes] : ['Length', media.duration ? `${media.duration} min${media.format === 'MOVIE' ? '' : ' per episode'}` : null],
    ['Status', statusLabel(media.status)],
    [manga ? 'Published' : 'Aired', start ? (end && end !== start ? `${start} – ${end}` : start) : null],
    manga ? ['Author', authors?.length ? [...new Set(authors)].join(', ') : null] : ['Studio', media.studios?.nodes.map((s) => s.name).join(', ')],
    ['Source', media.source ? (SOURCE[media.source] ?? media.source) : null],
    ['Score', scoreLabel(media.averageScore) ? `${scoreLabel(media.averageScore)} / 10` : null],
    ['Ranked', rank ? `#${rank.rank} ${rank.context.replace(/^highest rated all time$/i, 'highest rated').replace(/^most popular all time$/i, 'most popular')}` : null],
  ];
  const tags = (media.tags ?? []).filter((t) => !t.isMediaSpoiler && t.rank >= 60).slice(0, 8);

  return (
    <aside className="detail-facts">
      {media.nextAiringEpisode && (
        <div className="facts-next">
          <span className="facts-next-label">Next episode</span>
          <span className="facts-next-value num">
            E{media.nextAiringEpisode.episode} in {countdown(media.nextAiringEpisode.timeUntilAiring)}
          </span>
          <span className="faint num">
            {new Date(media.nextAiringEpisode.airingAt * 1000).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      )}
      {children}
      <dl className="facts-list">
        {facts
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k} className="facts-row">
              <dt>{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
      </dl>
      {tags.length > 0 && (
        <div className="facts-tags">
          {tags.map((t) => (
            <span key={t.name} className="tag">
              {t.name}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}

// ── Related & recommended ───────────────────────────────────────────────────

const RELATION_LABEL: Record<string, string> = {
  SEQUEL: 'Sequel',
  PREQUEL: 'Prequel',
  SIDE_STORY: 'Side story',
  PARENT: 'Main story',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Alternative',
  ADAPTATION: 'Adaptation',
  SOURCE: 'Source',
  SUMMARY: 'Summary',
  CHARACTER: 'Shares characters',
  COMPILATION: 'Compilation',
  CONTAINS: 'Contains',
  OTHER: 'Related',
};

const RELATION_ORDER = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ADAPTATION', 'SOURCE', 'ALTERNATIVE', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'CHARACTER', 'OTHER'];

export function RelatedGrid({ media }: { media: MediaDetail }) {
  const edges = [...(media.relations?.edges ?? [])].sort(
    (a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType),
  );
  if (!edges.length) return <EmptyState compact icon="discover" title="No related entries" body="AniList doesn’t list sequels, prequels or adaptations for this one." />;
  return (
    <div className="poster-grid">
      {edges.map((e) => (
        <PosterCard
          key={`${e.relationType}-${e.node.id}`}
          media={e.node}
          meta={
            <>
              <span className="relation">{RELATION_LABEL[e.relationType] ?? 'Related'}</span>
              <span>{isManga(e.node) ? mangaKind(e.node) : formatLabel(e.node.format)}</span>
            </>
          }
        />
      ))}
    </div>
  );
}

export function RecommendedGrid({ media }: { media: MediaDetail }) {
  const recs = (media.recommendations?.nodes ?? []).map((n) => n.mediaRecommendation!).filter(Boolean);
  if (!recs.length) return <EmptyState compact icon="discover" title="No recommendations yet" body="AniList users haven’t linked anything similar to this title." />;
  return (
    <div className="poster-grid">
      {recs.map((m) => (
        <PosterCard key={m.id} media={m} />
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="page is-flush">
      <header className="detail-head">
        <div className="detail-backdrop skeleton" />
        <div className="detail-grid">
          <div className="detail-poster skeleton" />
          <div className="detail-info">
            <div className="skeleton skeleton-line" style={{ width: 180 }} />
            <div className="skeleton" style={{ width: '70%', height: 54, marginTop: 16, borderRadius: 6 }} />
            <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 16 }} />
            <div className="skeleton" style={{ width: 320, height: 46, marginTop: 24, borderRadius: 7 }} />
          </div>
        </div>
      </header>
    </div>
  );
}
