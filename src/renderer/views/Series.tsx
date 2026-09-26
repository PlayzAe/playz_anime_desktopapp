import { useMemo, useState } from 'react';
import type { Audio, Episode, EpisodeList, MediaDetail, MediaSnapshot } from '../../shared/types';
import { Button, IconButton, Menu, ProgressBar, Segmented, Tabs } from '../components/Controls';
import { DetailFacts, DetailHeader, DetailSkeleton, RecommendedGrid, RelatedGrid } from '../components/Detail';
import { EpisodeDownloadDialog } from '../components/DownloadDialogs';
import { Icon } from '../components/Icon';
import { ListButton } from '../components/ListButton';
import { Img } from '../components/Media';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { clock, snapshot } from '../lib/format';
import { Link, navigate, withQuery } from '../lib/router';
import { useApp, useWatched } from '../lib/store';
import './series.css';

const api = () => window.playzanime;

export function Series({ id }: { id: number }) {
  const { settings, historyFor } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const eps = useLoader(`eps:${id}`, () => api().episodes.list(id), 15 * 60_000);
  const { watched, setWatched } = useWatched(id);
  const [tab, setTab] = useState<'episodes' | 'related' | 'similar'>('episodes');
  const [trailer, setTrailer] = useState(false);

  if (media.error && !media.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t load this show" error={media.error} onRetry={media.reload} />
      </div>
    );
  }
  if (!media.data) return <DetailSkeleton />;

  const m = media.data;
  const snap = snapshot(m, settings.titleLanguage);
  const history = historyFor(id);
  const episodes = eps.data?.episodes ?? [];
  const isMovie = m.format === 'MOVIE';

  // Where "Watch" should land: the saved episode, else the first one not yet watched.
  const resumeEp = history && !(history.duration && history.position / history.duration > 0.9) ? history.episode : null;
  const nextEp = resumeEp ?? episodes.find((e) => !watched.has(e.number))?.number ?? episodes[0]?.number ?? 1;
  const started = Boolean(history) || watched.size > 0;
  const upcoming = m.status === 'NOT_YET_RELEASED';

  const primary = upcoming ? null : (
    <Button variant="primary" size="lg" icon="play" onClick={() => navigate(`/watch/${id}/${nextEp}`)}>
      {isMovie ? (history ? `Resume · ${clock(history.position)}` : 'Play movie') : started ? `${resumeEp ? 'Resume' : 'Watch'} E${nextEp}` : 'Watch E1'}
    </Button>
  );

  return (
    <div className="page is-flush">
      <DetailHeader
        media={m}
        actions={
          <>
            {primary}
            <ListButton media={snap} />
            {m.trailer?.site === 'youtube' && (
              <Button variant="ghost" size="lg" icon="play" onClick={() => setTrailer(true)}>
                Trailer
              </Button>
            )}
          </>
        }
      />

      <div className="detail-body">
        <div className="detail-main">
          <Tabs
            label="Sections"
            className="detail-tabs"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'episodes', label: isMovie ? 'Movie' : 'Episodes', count: episodes.length || undefined },
              { value: 'related', label: 'Related', count: m.relations?.edges.length || undefined },
              { value: 'similar', label: 'More like this' },
            ]}
          />
          {tab === 'episodes' &&
            (upcoming ? (
              <EmptyState compact icon="schedule" title="Not out yet" body="Add it to your library and it will show up in your schedule when it starts airing." />
            ) : eps.error && !eps.data ? (
              <ErrorState compact title="Couldn’t find episodes" error={eps.error} onRetry={eps.reload} />
            ) : !eps.data ? (
              <div className="eps-loading">
                <Spinner label="Matching episodes to a source" />
              </div>
            ) : (
              <EpisodesPanel media={m} snap={snap} list={eps.data} watched={watched} setWatched={setWatched} currentEp={history?.episode ?? null} nextEp={nextEp} onRefresh={() => void api().episodes.list(id, true).then(eps.reload)} />
            ))}
          {tab === 'related' && <RelatedGrid media={m} />}
          {tab === 'similar' && <RecommendedGrid media={m} />}
        </div>
        <DetailFacts media={m} />
      </div>

      {m.trailer?.site === 'youtube' && (
        <Modal open={trailer} onClose={() => setTrailer(false)} title="Trailer" width={880} bare>
          <div className="trailer-frame">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${m.trailer.id}?autoplay=1&rel=0`}
              title="Trailer"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Episodes ────────────────────────────────────────────────────────────────

const RANGE = 50;

interface PanelProps {
  media: MediaDetail;
  snap: MediaSnapshot;
  list: EpisodeList;
  watched: Set<number>;
  setWatched: (episodes: number[], value: boolean) => Promise<void>;
  currentEp: number | null;
  nextEp: number;
  onRefresh: () => void;
}

function EpisodesPanel({ media, snap, list, watched, setWatched, currentEp, nextEp, onRefresh }: PanelProps) {
  const { settings, updateSettings, historyFor } = useApp();
  const episodes = list.episodes;
  const history = historyFor(media.id);
  const [audio, setAudio] = useState<Audio>(settings.preferDub && list.hasDub ? 'dub' : 'sub');
  const [filter, setFilter] = useState('');
  const ranges = useMemo(() => {
    const out: { value: string; label: string; from: number; to: number }[] = [];
    for (let i = 0; i < episodes.length; i += RANGE) {
      const from = episodes[i].number;
      const to = episodes[Math.min(i + RANGE, episodes.length) - 1].number;
      out.push({ value: String(i / RANGE), label: `${from}–${to}`, from, to });
    }
    return out;
  }, [episodes]);
  const startRange = Math.max(0, ranges.findIndex((r) => nextEp >= r.from && nextEp <= r.to));
  const [range, setRange] = useState(String(startRange));
  const [dialog, setDialog] = useState<{ from: number; to: number } | null>(null);

  // Stills or rows: the viewer's choice sticks across shows; before choosing, stills win when the source has them.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      const saved = localStorage.getItem('playzanime:episode-view');
      if (saved === 'grid' || saved === 'list') return saved;
    } catch {
      /* private storage */
    }
    return episodes.filter((e) => e.thumbnail).length >= episodes.length / 2 ? 'grid' : 'list';
  });
  const pickView = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('playzanime:episode-view', v);
    } catch {
      /* private storage */
    }
  };
  const withThumbs = view === 'grid';
  const q = filter.trim().toLowerCase();
  const shown = q
    ? episodes.filter((e) => String(e.number) === q || e.title.toLowerCase().includes(q))
    : ranges.length > 1
      ? episodes.filter((e) => e.number >= ranges[Number(range)].from && e.number <= ranges[Number(range)].to)
      : episodes;

  const pickAudio = (a: Audio) => {
    setAudio(a);
    void updateSettings({ preferDub: a === 'dub' });
  };

  const open = (e: Episode) => navigate(withQuery(`/watch/${media.id}/${e.number}`, { audio: audio === 'dub' && e.dubUrl ? 'dub' : null }));

  return (
    <div className="eps">
      {list.fallback && (
        <div className="notice">
          <Icon name="alert" size={17} />
          <span>We couldn’t match this title to our episode source, so the list follows AniList’s numbering. Some episodes may not play.</span>
        </div>
      )}
      <div className="eps-toolbar">
        {ranges.length > 1 && !q && <Segmented label="Episode range" size="sm" value={range} onChange={setRange} options={ranges.map((r) => ({ value: r.value, label: r.label }))} />}
        {episodes.length > 12 && (
          <label className="eps-filter">
            <Icon name="search" size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an episode" aria-label="Find an episode" />
          </label>
        )}
        <div className="eps-spacer" />
        <div className="view-toggle" role="group" aria-label="Episode layout">
          <IconButton icon="grid" size={17} label="Show episode stills" active={view === 'grid'} aria-pressed={view === 'grid'} onClick={() => pickView('grid')} />
          <IconButton icon="list" size={17} label="Show as a list" active={view === 'list'} aria-pressed={view === 'list'} onClick={() => pickView('list')} />
        </div>
        {list.hasDub && (
          <Segmented
            label="Audio"
            size="sm"
            value={audio}
            onChange={pickAudio}
            options={[
              { value: 'sub', label: 'Sub' },
              { value: 'dub', label: 'Dub' },
            ]}
          />
        )}
        <Button variant="ghost" size="sm" icon="downloads" onClick={() => setDialog({ from: nextEp, to: episodes[episodes.length - 1]?.number ?? nextEp })}>
          Download
        </Button>
        <Menu
          width={230}
          items={[
            { key: 'all', label: 'Mark all as watched', icon: 'check', onSelect: () => void setWatched(episodes.map((e) => e.number), true) },
            { key: 'none', label: 'Mark all as unwatched', icon: 'close', onSelect: () => void setWatched(episodes.map((e) => e.number), false) },
            'divider',
            { key: 'refresh', label: 'Look for new episodes', icon: 'refresh', onSelect: onRefresh },
          ]}
          trigger={({ toggle, open, id }) => (
            <IconButton icon="more" label="More episode actions" aria-expanded={open} aria-controls={id} onClick={toggle} />
          )}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState compact icon="search" title={`No episode matches “${filter}”`} body="Search by number or by a word from the title." />
      ) : (
        <div className={withThumbs ? 'eps-grid' : 'eps-list'}>
          {shown.map((e) => {
            const isWatched = watched.has(e.number);
            const inProgress = history && history.episode === e.number && !isWatched ? history.position / (history.duration || 1) : null;
            const unavailable = audio === 'dub' ? !e.dubUrl : !e.subUrl;
            return (
              <div key={e.number} className={`ep ${isWatched ? 'is-watched' : ''} ${e.number === nextEp ? 'is-next' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
                <button type="button" className="ep-open" onClick={() => open(e)} disabled={!e.subUrl && !e.dubUrl}>
                  {withThumbs && (
                    <div className="ep-thumb">
                      <Img src={e.thumbnail ?? media.bannerImage} color={media.coverImage?.color} />
                      {!e.thumbnail && <span className="ep-thumb-num display">{e.number}</span>}
                      <span className="ep-play" aria-hidden="true">
                        <Icon name="play" size={18} />
                      </span>
                      {inProgress !== null && <ProgressBar value={inProgress} className="ep-progress" />}
                    </div>
                  )}
                  <div className="ep-text">
                    <span className="ep-num num">
                      {media.format === 'MOVIE' ? 'Movie' : `Episode ${e.number}`}
                      {e.number === nextEp && currentEp !== null && <span className="ep-next">Up next</span>}
                      {e.dubUrl && audio === 'sub' && <span className="ep-flag">Dub</span>}
                    </span>
                    <span className="ep-title clamp-2">{/^episode\s*\d+$/i.test(e.title) ? '' : e.title}</span>
                    {!withThumbs && inProgress !== null && <ProgressBar value={inProgress} className="ep-progress-inline" />}
                  </div>
                </button>
                <div className="ep-actions">
                  <IconButton
                    icon="check"
                    size={16}
                    label={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
                    active={isWatched}
                    onClick={() => void setWatched([e.number], !isWatched)}
                  />
                  <IconButton icon="downloads" size={16} label={`Download episode ${e.number}`} onClick={() => setDialog({ from: e.number, to: e.number })} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="eps-foot faint">
        Streams come from third-party hosts. If one won’t play, switch to the embed player on the watch page, or <Link to="/settings">change the default player</Link>.
      </p>

      <EpisodeDownloadDialog open={dialog !== null} onClose={() => setDialog(null)} media={snap} episodes={episodes} initial={dialog ?? undefined} defaultAudio={audio} />
    </div>
  );
}
