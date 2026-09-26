import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Audio, Episode, ResolvedStream } from '../../shared/types';
import { Button, IconButton, Segmented, Switch } from '../components/Controls';
import { EpisodeDownloadDialog } from '../components/DownloadDialogs';
import { Icon } from '../components/Icon';
import { Img } from '../components/Media';
import { ErrorState, friendlyError, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { coverOf, snapshot, titleOf } from '../lib/format';
import { Link, navigate, useRoute, withQuery } from '../lib/router';
import { useApp, useWatched } from '../lib/store';
import { DirectPlayer } from '../player/DirectPlayer';
import { EmbedPlayer } from '../player/EmbedPlayer';
import './watch.css';

const api = () => window.playzanime;

type StreamState =
  | { status: 'idle' }
  | { status: 'resolving'; slow: boolean }
  | { status: 'ready'; stream: ResolvedStream }
  | { status: 'error'; message: string };

function readTheater(): boolean {
  try {
    return localStorage.getItem('playzanime:theater') === '1';
  } catch {
    return false;
  }
}

const epLabel = (e: Episode, isMovie: boolean) =>
  isMovie ? 'Full movie' : /^episode\s*\d+$/i.test(e.title) ? `Episode ${e.number}` : `E${e.number} · ${e.title}`;

export function Watch({ id, ep }: { id: number; ep: number }) {
  const route = useRoute();
  const { settings, updateSettings, historyFor, saveHistory } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const eps = useLoader(`eps:${id}`, () => api().episodes.list(id), 15 * 60_000);
  const { watched, setWatched } = useWatched(id);

  const episodes = eps.data?.episodes ?? [];
  const index = episodes.findIndex((e) => e.number === ep);
  const episode = index >= 0 ? episodes[index] : undefined;
  const prev = index > 0 ? episodes[index - 1] : undefined;
  const next = index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : undefined;
  const isMovie = media.data?.format === 'MOVIE';

  const audioParam = route.query.get('audio') as Audio | null;
  // Sub or dub is remembered per show (from its watch history) before falling back to the global preference.
  const [audio, setAudio] = useState<Audio>(() => audioParam ?? historyFor(id)?.audio ?? (settings.preferDub ? 'dub' : 'sub'));
  const effectiveAudio: Audio = audio === 'dub' && episode?.dubUrl ? 'dub' : episode?.subUrl ? 'sub' : 'dub';
  const embedUrl = episode ? (effectiveAudio === 'dub' ? episode.dubUrl : episode.subUrl) : null;

  const [mode, setMode] = useState(settings.player);
  const [theater, setTheater] = useState(readTheater);
  const [state, setState] = useState<StreamState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [download, setDownload] = useState(false);
  // Stream links expire (HTTP 403 mid-episode). The first failure fetches a fresh link and
  // carries on from where playback was; only a second failure is shown.
  const lastPosition = useRef(0);
  const autoRetried = useRef(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const onFatal = (message: string) => {
    if (autoRetried.current) {
      setState({ status: 'error', message });
      return;
    }
    autoRetried.current = true;
    setRetryAt(lastPosition.current || null);
    setAttempt((a) => a + 1);
  };

  // Where to start: an explicit ?t=, else this episode's saved position.
  const startAt = useMemo(() => {
    const t = Number(route.query.get('t'));
    if (t > 0) return t;
    const h = historyFor(id);
    if (h && h.episode === ep && h.position > 10 && h.position < h.duration - 30) return h.position;
    return 0;
    // Only on arrival: later history writes must not move the playhead.
  }, [id, ep]);

  // Resolve the direct stream.
  useEffect(() => {
    if (mode !== 'direct' || !embedUrl) return;
    let live = true;
    setState({ status: 'resolving', slow: false });
    const slow = window.setTimeout(() => live && setState((s) => (s.status === 'resolving' ? { status: 'resolving', slow: true } : s)), 12000);
    api()
      .stream.resolve(embedUrl, attempt > 0)
      .then((stream) => live && setState({ status: 'ready', stream }))
      .catch((err: Error) => live && setState({ status: 'error', message: friendlyError(err) }))
      .finally(() => window.clearTimeout(slow));
    return () => {
      live = false;
      window.clearTimeout(slow);
    };
  }, [embedUrl, mode, attempt]);

  // Warm up the next episode once this one is well under way, so "Next" starts instantly.
  const prefetched = useRef<string | null>(null);
  const prefetchNext = useCallback(() => {
    const url = next ? (effectiveAudio === 'dub' ? (next.dubUrl ?? next.subUrl) : next.subUrl) : null;
    if (!url || prefetched.current === url || mode !== 'direct' || settings.dataSaver) return;
    prefetched.current = url;
    void api().stream.resolve(url).catch(() => {});
  }, [next, effectiveAudio, mode, settings.dataSaver]);

  const snap = media.data ? snapshot(media.data, settings.titleLanguage) : null;

  const onProgress = useCallback(
    (position: number, duration: number) => {
      lastPosition.current = position;
      if (!snap || !episode || duration < 30) return;
      saveHistory({
        media: snap,
        episode: episode.number,
        episodeTitle: episode.title,
        thumbnail: episode.thumbnail ?? null,
        position,
        duration,
        audio: effectiveAudio,
        updatedAt: Date.now(),
      });
      if (position / duration > 0.55) prefetchNext();
    },
    [snap?.id, episode?.number, effectiveAudio, prefetchNext],
  );

  const goTo = useCallback(
    (e?: Episode) => {
      if (!e) return;
      navigate(withQuery(`/watch/${id}/${e.number}`, { audio: effectiveAudio === 'dub' && e.dubUrl ? 'dub' : null }), { replace: true });
    },
    [id, effectiveAudio],
  );

  const toggleTheater = () => {
    setTheater((t) => {
      try {
        localStorage.setItem('playzanime:theater', t ? '0' : '1');
      } catch {
        /* private storage */
      }
      return !t;
    });
  };

  // Persisting volume on every slider tick would write the settings file dozens of times a second.
  const volumeTimer = useRef<number | undefined>(undefined);
  const onVolume = (v: number) => {
    window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => void updateSettings({ volume: v }), 600);
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }, [ep, episodes.length, theater]);

  if (media.error && !media.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t load this show" error={media.error} onRetry={media.reload} />
      </div>
    );
  }

  const title = media.data ? titleOf(media.data, settings.titleLanguage) : '';
  const heading = episode ? epLabel(episode, isMovie) : `Episode ${ep}`;
  const poster = episode?.thumbnail || media.data?.bannerImage || (media.data ? coverOf(media.data) : null);

  let stage;
  if (eps.error && !eps.data) {
    stage = <ErrorState title="Couldn’t find episodes" error={eps.error} onRetry={eps.reload} />;
  } else if (eps.data && !episode) {
    stage = (
      <div className="stage-message">
        <h2>Episode {ep} isn’t available</h2>
        <p>The source lists {episodes.length} episodes for this show.</p>
        <Button onClick={() => navigate(`/anime/${id}`)}>See all episodes</Button>
      </div>
    );
  } else if (!embedUrl) {
    stage = (
      <div className="stage-message">
        <Spinner size={30} label="Finding episodes" />
      </div>
    );
  } else if (mode === 'embed') {
    stage = <EmbedPlayer url={embedUrl} startAt={startAt} onProgress={onProgress} />;
  } else if (state.status === 'ready' && state.stream.embedUrl === embedUrl) {
    stage = (
      <DirectPlayer
        key={`${embedUrl}#${attempt}`}
        stream={state.stream}
        startAt={retryAt ?? startAt}
        title={heading}
        subtitle={title}
        artwork={media.data ? coverOf(media.data) : null}
        volume={settings.volume}
        subtitleLanguage={settings.subtitleLanguage}
        preferSubtitles={effectiveAudio === 'sub'}
        autoSkipIntro={settings.autoSkipIntro}
        autoplayNext={settings.autoplayNext}
        dataSaver={settings.dataSaver}
        hasPrev={Boolean(prev)}
        hasNext={Boolean(next)}
        nextLabel={next ? epLabel(next, isMovie) : null}
        theater={theater}
        onTheater={toggleTheater}
        onPrev={() => goTo(prev)}
        onNext={() => goTo(next)}
        onProgress={onProgress}
        onWatched={() => void setWatched([ep], true)}
        onVolume={onVolume}
        onFatal={onFatal}
      />
    );
  } else if (state.status === 'error') {
    stage = (
      <div className="stage-message">
        <Icon name="alert" size={28} />
        <h2>This stream wouldn’t load</h2>
        <p>{state.message}</p>
        <div className="stage-actions">
          <Button variant="primary" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
          <Button icon="globe" onClick={() => setMode('embed')}>
            Use the embed player
          </Button>
        </div>
      </div>
    );
  } else {
    stage = (
      <div className="stage-loading">
        {poster && <Img src={poster} className="stage-poster" eager />}
        <div className="stage-loading-body">
          <Spinner size={34} />
          <span>{state.status === 'resolving' && state.slow ? 'This source is slow today. Still trying…' : 'Finding the stream'}</span>
          {state.status === 'resolving' && state.slow && (
            <Button size="sm" icon="globe" onClick={() => setMode('embed')}>
              Use the embed player instead
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`page watch ${theater ? 'is-theater' : ''}`}>
      <div className="watch-main">
        <div className="watch-stage">{stage}</div>
        <div className="watch-info">
          <div className="watch-titles">
            <Link to={`/anime/${id}`} className="watch-series">
              {title}
              <Icon name="chevronRight" size={14} />
            </Link>
            <h1 className="watch-heading">{heading}</h1>
          </div>
          <div className="watch-actions">
            {eps.data?.hasDub && (
              <Segmented
                label="Audio"
                size="sm"
                value={effectiveAudio}
                onChange={(a) => {
                  setAudio(a);
                  void updateSettings({ preferDub: a === 'dub' });
                }}
                options={[
                  { value: 'sub', label: 'Sub' },
                  { value: 'dub', label: 'Dub', disabled: !episode?.dubUrl, title: episode?.dubUrl ? undefined : 'No dub for this episode' },
                ]}
              />
            )}
            <Segmented
              label="Player"
              size="sm"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setAttempt(0);
              }}
              options={[
                { value: 'direct', label: 'PlayzAnime', title: 'Our player: keyboard shortcuts, skip intro, no ads' },
                { value: 'embed', label: 'Embed', title: 'The source’s own player, as a fallback' },
              ]}
            />
            <Button size="sm" variant="ghost" icon="downloads" onClick={() => setDownload(true)} disabled={!episode}>
              Download
            </Button>
            <IconButton icon="prev" label="Previous episode (P)" disabled={!prev} onClick={() => goTo(prev)} />
            <IconButton icon="next" label="Next episode (N)" disabled={!next} onClick={() => goTo(next)} />
          </div>
        </div>
      </div>

      <aside className="watch-side">
        <div className="side-head">
          <span className="section-title">{isMovie ? 'Movie' : 'Episodes'}</span>
          <label className="side-autoplay">
            Autoplay
            <Switch checked={settings.autoplayNext} onChange={(v) => void updateSettings({ autoplayNext: v })} label="Autoplay next episode" />
          </label>
        </div>
        <div className="side-list" ref={listRef}>
          {episodes.map((e) => {
            const current = e.number === ep;
            const done = watched.has(e.number);
            return (
              <button key={e.number} type="button" className={`side-ep ${current ? 'is-current' : ''} ${done ? 'is-watched' : ''}`} onClick={() => goTo(e)}>
                {e.thumbnail ? (
                  <Img src={e.thumbnail} color={media.data?.coverImage?.color} className="side-thumb" />
                ) : (
                  <span className="side-num display">{e.number}</span>
                )}
                <span className="side-text">
                  <span className="side-ep-num num">
                    {isMovie ? 'Movie' : `Episode ${e.number}`}
                    {current && <span className="side-now">Now</span>}
                  </span>
                  <span className="side-ep-title clamp-2">{/^episode\s*\d+$/i.test(e.title) ? '' : e.title}</span>
                </span>
                {done && !current && <Icon name="check" size={15} className="side-check" />}
              </button>
            );
          })}
          {!eps.data && !eps.error && (
            <div className="side-loading">
              <Spinner size={20} label="Loading episodes" />
            </div>
          )}
        </div>
      </aside>

      {snap && episode && (
        <EpisodeDownloadDialog open={download} onClose={() => setDownload(false)} media={snap} episodes={episodes} initial={{ from: ep, to: ep }} defaultAudio={effectiveAudio} />
      )}
    </div>
  );
}
