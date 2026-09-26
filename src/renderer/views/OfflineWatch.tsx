import { useCallback, useMemo, useRef, useState } from 'react';
import { OFFLINE_MEDIA } from '../../shared/api';
import type { OfflineItem, ResolvedStream } from '../../shared/types';
import { Button, IconButton } from '../components/Controls';
import { Icon } from '../components/Icon';
import { ErrorState, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { bytes } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { useApp, useWatched } from '../lib/store';
import { DirectPlayer } from '../player/DirectPlayer';
import './watch.css';

const api = () => window.playzanime;

/** Higher quality first, then the audio the person prefers. */
function rank(a: OfflineItem, b: OfflineItem, preferDub: boolean) {
  const q = (i: OfflineItem) => parseInt(i.quality ?? '0', 10) || 0;
  const audio = (i: OfflineItem) => ((i.audio === 'dub') === preferDub ? 1 : 0);
  return audio(b) - audio(a) || q(b) - q(a);
}

/** Plays a downloaded episode from disk, with the same player as streaming. No network needed. */
export function OfflineWatch({ jobId }: { jobId: string }) {
  const { settings, updateSettings, historyFor, saveHistory } = useApp();
  const items = useLoader('offline:items', () => api().offline.items(), 10_000);
  const item = items.data?.find((i) => i.jobId === jobId);
  const { watched, setWatched } = useWatched(item?.media.id ?? null);
  const [theater, setTheater] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  // One entry per downloaded episode of this show (the best copy when there are several).
  const episodes = useMemo(() => {
    if (!item || !items.data) return [];
    const byEp = new Map<number, OfflineItem[]>();
    for (const i of items.data) if (i.kind === 'episode' && i.media.id === item.media.id && i.episode) byEp.set(i.episode, [...(byEp.get(i.episode) ?? []), i]);
    return [...byEp.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ep, copies]) => ({ ep, copies, best: ep === item.episode ? item : copies.sort((a, b) => rank(a, b, settings.preferDub))[0] }));
  }, [item, items.data, settings.preferDub]);
  const index = episodes.findIndex((e) => e.ep === item?.episode);
  const prev = index > 0 ? episodes[index - 1] : null;
  const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null;

  const stream = useMemo<ResolvedStream | null>(() => {
    if (!item) return null;
    const src = `${OFFLINE_MEDIA}/${encodeURIComponent(item.jobId)}`;
    return {
      embedUrl: src,
      master: src,
      host: 'local',
      variants: [],
      subtitles: item.subtitles ? [{ label: 'Subtitles', url: `${src}/subs`, isDefault: true }] : [],
      intro: null,
      outro: null,
      resolvedAt: 0,
    };
  }, [item?.jobId]);

  const history = item ? historyFor(item.media.id) : undefined;
  const startAt = history && history.episode === item?.episode && history.position < history.duration - 30 ? history.position : 0;

  const onProgress = useCallback(
    (position: number, duration: number) => {
      if (!item?.episode || duration < 30) return;
      saveHistory({ media: item.media, episode: item.episode, episodeTitle: null, thumbnail: null, position, duration, audio: item.audio ?? 'sub', updatedAt: Date.now() });
    },
    [item?.jobId],
  );

  const goTo = (e: (typeof episodes)[number] | null) => e && navigate(`/offline/watch/${encodeURIComponent(e.best.jobId)}`, { replace: true });

  const volumeTimer = useRef<number | undefined>(undefined);
  const onVolume = (v: number) => {
    window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => void updateSettings({ volume: v }), 600);
  };

  if (items.error && !items.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t read your downloads" error={items.error} onRetry={items.reload} />
      </div>
    );
  }
  if (items.data && !item) {
    return (
      <div className="page">
        <ErrorState title="That episode isn’t downloaded any more" error={new Error('It may have been removed from Downloads.')} onRetry={() => navigate('/downloads')} />
      </div>
    );
  }

  const heading = item?.episode ? `Episode ${item.episode}` : (item?.label ?? '');
  let stage;
  if (!item || !stream) {
    stage = (
      <div className="stage-message">
        <Spinner size={30} label="Opening the file" />
      </div>
    );
  } else if (fatal) {
    stage = (
      <div className="stage-message">
        <Icon name="alert" size={28} />
        <h2>This file wouldn’t play</h2>
        <p>{fatal} It may have been moved, renamed or only partly written.</p>
        <div className="stage-actions">
          <Button variant="primary" icon="folder" onClick={() => void api().downloads.reveal(item.jobId)}>
            Show in folder
          </Button>
          <Button icon="external" onClick={() => void api().downloads.open(item.jobId)}>
            Open in another player
          </Button>
        </div>
      </div>
    );
  } else {
    stage = (
      <DirectPlayer
        key={item.jobId}
        stream={stream}
        startAt={startAt}
        title={heading}
        subtitle={item.media.title}
        artwork={item.media.cover || null}
        volume={settings.volume}
        subtitleLanguage={settings.subtitleLanguage}
        preferSubtitles={item.subtitles}
        autoSkipIntro={false}
        autoplayNext={settings.autoplayNext}
        dataSaver={false}
        hasPrev={Boolean(prev)}
        hasNext={Boolean(next)}
        nextLabel={next ? `Episode ${next.ep}` : null}
        theater={theater}
        onTheater={() => setTheater((t) => !t)}
        onPrev={() => goTo(prev)}
        onNext={() => goTo(next)}
        onProgress={onProgress}
        onWatched={() => item.episode && void setWatched([item.episode], true)}
        onVolume={onVolume}
        onFatal={(message) => setFatal(message)}
      />
    );
  }

  return (
    <div className={`page watch ${theater ? 'is-theater' : ''}`}>
      <div className="watch-main">
        <div className="watch-stage">{stage}</div>
        <div className="watch-info">
          <div className="watch-titles">
            <Link to="/downloads" className="watch-series">
              <Icon name="downloads" size={14} />
              {item?.media.title}
              <Icon name="chevronRight" size={14} />
            </Link>
            <h1 className="watch-heading">{heading}</h1>
          </div>
          <div className="watch-actions">
            {item && (
              <span className="watch-local num">
                From your downloads · {[item.quality, item.audio?.toUpperCase(), bytes(item.bytes)].filter(Boolean).join(' · ')}
              </span>
            )}
            <IconButton icon="folder" label="Show in folder" disabled={!item} onClick={() => item && void api().downloads.reveal(item.jobId)} />
            <IconButton icon="prev" label="Previous episode (P)" disabled={!prev} onClick={() => goTo(prev)} />
            <IconButton icon="next" label="Next episode (N)" disabled={!next} onClick={() => goTo(next)} />
          </div>
        </div>
      </div>

      <aside className="watch-side">
        <div className="side-head">
          <span className="section-title">Downloaded</span>
        </div>
        <div className="side-list">
          {episodes.map((e) => {
            const current = e.ep === item?.episode;
            return (
              <button key={e.ep} type="button" className={`side-ep ${current ? 'is-current' : ''} ${watched.has(e.ep) ? 'is-watched' : ''}`} onClick={() => goTo(e)}>
                <span className="side-num display">{e.ep}</span>
                <span className="side-text">
                  <span className="side-ep-num num">
                    Episode {e.ep}
                    {current && <span className="side-now">Now</span>}
                  </span>
                  <span className="side-ep-title">{e.copies.map((c) => [c.quality, c.audio?.toUpperCase()].filter(Boolean).join(' ')).join(' · ')}</span>
                </span>
                {watched.has(e.ep) && !current && <Icon name="check" size={15} className="side-check" />}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
