import Hls, { type ErrorData } from 'hls.js';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ResolvedStream } from '../../shared/types';
import { Menu } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/States';
import { clock } from '../lib/format';
import './player.css';

export interface DirectPlayerProps {
  stream: ResolvedStream;
  startAt: number;
  title: string;
  subtitle: string;
  artwork?: string | null;
  volume: number;
  subtitleLanguage: string;
  preferSubtitles: boolean;
  autoSkipIntro: boolean;
  autoplayNext: boolean;
  dataSaver: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  nextLabel?: string | null;
  theater: boolean;
  onTheater: () => void;
  onPrev: () => void;
  onNext: () => void;
  onProgress: (position: number, duration: number) => void;
  onWatched: () => void;
  onVolume: (volume: number) => void;
  onFatal: (message: string) => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const UP_NEXT_SECONDS = 10;

function describe(data: ErrorData): string {
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    const code = data.response?.code;
    return code ? `The stream host answered ${code}. The link may have expired.` : 'The stream stopped loading. Check your connection.';
  }
  return 'The video could not be decoded.';
}

export function DirectPlayer(props: DirectPlayerProps) {
  const { stream, title, subtitle, artwork, hasPrev, hasNext } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const trackRefs = useRef<(HTMLTrackElement | null)[]>([]);
  const cueRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(props.startAt);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(props.volume);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [levels, setLevels] = useState<{ index: number; height: number }[]>([]);
  const [level, setLevel] = useState(-1);
  const [subIndex, setSubIndex] = useState(-1);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [upNext, setUpNext] = useState<number | null>(null);
  // Shown at the end when autoplay is off: the same card, no countdown.
  const [upNextIdle, setUpNextIdle] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const skipped = useRef(false);
  const watchedSent = useRef(false);
  const upNextDismissed = useRef(false);
  const hideTimer = useRef<number | undefined>(undefined);

  const video = () => videoRef.current!;

  const say = useCallback((text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash((f) => (f === text ? null : f)), 1100);
  }, []);

  // ── Source ──
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    skipped.current = false;
    watchedSent.current = false;
    upNextDismissed.current = false;
    setUpNext(null);
    setUpNextIdle(false);
    setWaiting(true);
    const startAt = propsRef.current.startAt;

    // Downloaded episodes are plain MP4 files the browser plays on its own.
    if (!Hls.isSupported() || stream.master.startsWith('pzmedia:')) {
      el.src = stream.master;
      if (startAt > 0) el.currentTime = startAt;
      void el.play().catch(() => {});
      return;
    }
    const saver = propsRef.current.dataSaver;
    // Data saver keeps only a few seconds ahead, so closing the player wastes almost nothing.
    const hls = new Hls({
      startPosition: startAt > 0 ? startAt : -1,
      maxBufferLength: saver ? 10 : 45,
      maxMaxBufferLength: saver ? 20 : 120,
      backBufferLength: saver ? 20 : 90,
      enableWorker: true,
    });
    hlsRef.current = hls;
    let networkRetries = 0;
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      setLevels(data.levels.map((l, index) => ({ index, height: l.height })).filter((l) => l.height > 0).sort((a, b) => b.height - a.height));
      if (saver) {
        const cap = data.levels.reduce((best, l, i) => (l.height > 0 && l.height <= 720 && (best < 0 || l.height > data.levels[best].height) ? i : best), -1);
        if (cap >= 0) hls.autoLevelCapping = cap;
      }
      void el.play().catch(() => setPlaying(false));
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 2) {
        window.setTimeout(() => hls.startLoad(), 800 * networkRetries);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        propsRef.current.onFatal(describe(data));
      }
    });
    hls.loadSource(stream.master);
    hls.attachMedia(el);
    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [stream.master]);

  // ── Subtitles: pick the preferred language, render cues ourselves ──
  useEffect(() => {
    const p = propsRef.current;
    if (!p.preferSubtitles || !stream.subtitles.length) {
      setSubIndex(-1);
      return;
    }
    const want = p.subtitleLanguage.toLowerCase();
    let i = stream.subtitles.findIndex((s) => s.label.toLowerCase() === want);
    if (i < 0) i = stream.subtitles.findIndex((s) => s.label.toLowerCase().startsWith(want));
    if (i < 0) i = stream.subtitles.findIndex((s) => s.isDefault);
    setSubIndex(i);
  }, [stream.subtitles]);

  useEffect(() => {
    const elements = trackRefs.current;
    elements.forEach((t, i) => {
      if (t?.track) t.track.mode = i === subIndex ? 'hidden' : 'disabled';
    });
    const track = subIndex >= 0 ? elements[subIndex]?.track : null;
    const box = cueRef.current;
    if (!box) return;
    box.replaceChildren();
    if (!track) return;
    const render = () => {
      box.replaceChildren();
      const cues = track.activeCues;
      if (!cues) return;
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i] as VTTCue;
        const line = document.createElement('span');
        line.className = 'cue-line';
        // The browser's own WebVTT parser builds this fragment; only cue markup (i, b, u, ruby) survives.
        line.appendChild(cue.getCueAsHTML());
        box.appendChild(line);
      }
    };
    track.addEventListener('cuechange', render);
    render();
    return () => track.removeEventListener('cuechange', render);
  }, [subIndex, stream.subtitles]);

  // ── Progress reporting ──
  useEffect(() => {
    // Captured now: React detaches the ref before this effect's cleanup runs.
    const v = videoRef.current;
    const id = window.setInterval(() => {
      if (v && !v.paused && v.duration) propsRef.current.onProgress(v.currentTime, v.duration);
    }, 5000);
    return () => {
      window.clearInterval(id);
      if (v && v.duration) propsRef.current.onProgress(v.currentTime, v.duration);
    };
  }, []);

  // ── Intro / outro / watched / up next ──
  const intro = stream.intro;
  const outro = stream.outro;
  const inIntro = Boolean(intro && time >= intro.start && time < intro.end - 1);
  const inOutro = Boolean(outro && time >= outro.start && time < outro.end - 1);

  useEffect(() => {
    if (inIntro && props.autoSkipIntro && !skipped.current && intro) {
      skipped.current = true;
      video().currentTime = intro.end;
      say('Skipped intro');
    }
    if (!watchedSent.current && duration > 0 && (time / duration > 0.9 || (outro && time >= outro.start))) {
      watchedSent.current = true;
      props.onWatched();
    }
    // Credits started: offer the next episode while they roll.
    if (outro && inOutro && hasNext && props.autoplayNext && upNext === null && !upNextDismissed.current) {
      setUpNext(UP_NEXT_SECONDS);
    }
  }, [time, duration, inIntro, inOutro]);

  useEffect(() => {
    if (upNext === null) return;
    if (upNext <= 0) {
      setUpNext(null);
      propsRef.current.onNext();
      return;
    }
    if (!playing && !video().ended) return;
    const t = window.setTimeout(() => setUpNext((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [upNext, playing]);

  // ── Controls ──
  const toggle = useCallback(() => {
    const v = video();
    if (v.paused || v.ended) void v.play();
    else v.pause();
  }, []);

  // Holding an arrow key fires a seek every few milliseconds, and a burst of seeks is what
  // leaves the picture frozen while audio carries on. Presses are added up and applied once.
  const pendingSeek = useRef<{ target: number; total: number } | null>(null);
  const seekTimer = useRef<number | undefined>(undefined);
  const seekBy = useCallback((delta: number) => {
    const v = video();
    const base = pendingSeek.current?.target ?? v.currentTime;
    const target = Math.max(0, Math.min((v.duration || 0) - 0.5, base + delta));
    const total = (pendingSeek.current?.total ?? 0) + delta;
    pendingSeek.current = { target, total };
    setTime(target);
    say(`${total > 0 ? '+' : '−'}${Math.abs(total)}s`);
    window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      if (pendingSeek.current) v.currentTime = pendingSeek.current.target;
      pendingSeek.current = null;
    }, 160);
  }, [say]);

  // Watchdog for a frozen picture: time moves on but no new frame has been shown for
  // several seconds. Rebuilding the decoder pipeline brings the video back in place.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !('requestVideoFrameCallback' in v)) return;
    let lastFrame = performance.now();
    let lastTime = v.currentTime;
    let handle = 0;
    const onFrame = () => {
      lastFrame = performance.now();
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    const timer = window.setInterval(() => {
      const moving = v.currentTime - lastTime > 0.5;
      lastTime = v.currentTime;
      if (v.paused || v.seeking || v.readyState < 3 || document.hidden || !moving) {
        lastFrame = performance.now();
        return;
      }
      if (performance.now() - lastFrame > 4000 && hlsRef.current) {
        lastFrame = performance.now();
        hlsRef.current.recoverMediaError();
      }
    }, 1000);
    return () => {
      v.cancelVideoFrameCallback(handle);
      window.clearInterval(timer);
    };
  }, [stream.master]);

  const setVol = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    video().volume = clamped;
    video().muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
    propsRef.current.onVolume(clamped);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  const skipIntro = useCallback(() => {
    if (intro) {
      skipped.current = true;
      video().currentTime = intro.end;
    }
  }, [intro]);

  const pickLevel = (index: number) => {
    if (hlsRef.current) hlsRef.current.currentLevel = index;
    setLevel(index);
  };

  const pickSpeed = (s: number) => {
    video().playbackRate = s;
    setSpeed(s);
  };

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.volume = props.volume;
    }
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Keyboard. Ignored while typing or while a modifier is held (so Ctrl+K still opens search).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable], [role="menu"], .palette')) return;
      const v = videoRef.current;
      if (!v) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') toggle();
      else if (k === 'arrowleft') seekBy(-5);
      else if (k === 'arrowright') seekBy(5);
      else if (k === 'j') seekBy(-10);
      else if (k === 'l') seekBy(10);
      else if (k === 'arrowup') setVol(v.volume + 0.05);
      else if (k === 'arrowdown') setVol(v.volume - 0.05);
      else if (k === 'm') {
        v.muted = !v.muted;
        setMuted(v.muted);
      } else if (k === 'f') toggleFullscreen();
      else if (k === 't') propsRef.current.onTheater();
      else if (k === 's' && inIntroRef.current) skipIntro();
      else if (k === 'n' && propsRef.current.hasNext) propsRef.current.onNext();
      else if (k === 'p' && propsRef.current.hasPrev) propsRef.current.onPrev();
      else if (k === 'c' && stream.subtitles.length) setSubIndex((i) => (i + 1 >= stream.subtitles.length ? -1 : i + 1));
      else if (k >= '0' && k <= '9' && v.duration) v.currentTime = (v.duration * Number(k)) / 10;
      else return;
      e.preventDefault();
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const inIntroRef = useRef(inIntro);
  inIntroRef.current = inIntro;

  // ── OS integration: media keys, the Windows media flyout, taskbar buttons ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: subtitle,
      album: 'PlayzAnime',
      artwork: artwork ? [{ src: artwork, sizes: '460x650' }] : [],
    });
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    set('play', () => void videoRef.current?.play());
    set('pause', () => videoRef.current?.pause());
    set('seekbackward', () => seekBy(-10));
    set('seekforward', () => seekBy(10));
    set('previoustrack', hasPrev ? () => propsRef.current.onPrev() : null);
    set('nexttrack', hasNext ? () => propsRef.current.onNext() : null);
    return () => {
      navigator.mediaSession.metadata = null;
      (['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as MediaSessionAction[]).forEach((a) => set(a, null));
    };
  }, [title, subtitle, artwork, hasPrev, hasNext, seekBy]);

  useEffect(() => {
    void window.playzanime.app.setPlayer({ playing, hasPrev, hasNext });
  }, [playing, hasPrev, hasNext]);

  useEffect(() => {
    const off = window.playzanime.app.onCommand((cmd) => {
      if (cmd === 'player:toggle') toggle();
      else if (cmd === 'player:next' && propsRef.current.hasNext) propsRef.current.onNext();
      else if (cmd === 'player:prev' && propsRef.current.hasPrev) propsRef.current.onPrev();
    });
    return () => {
      off();
      void window.playzanime.app.setPlayer(null);
    };
  }, [toggle]);

  // ── Auto-hiding chrome ──
  const wake = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      // Keep the controls up while a menu is open.
      if (v && !v.paused && !rootRef.current?.querySelector('.menu-panel')) setChrome(false);
    }, 2600);
  }, []);
  useEffect(() => {
    if (!playing) {
      setChrome(true);
      window.clearTimeout(hideTimer.current);
    } else wake();
  }, [playing, wake]);

  // ── Seek bar ──
  const timeAt = (clientX: number) => {
    const r = seekRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (duration || 0);
  };
  const onSeekDown = (e: ReactPointerEvent) => {
    if (!duration) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setScrub(timeAt(e.clientX));
  };
  const onSeekMove = (e: ReactPointerEvent) => {
    const r = seekRef.current!.getBoundingClientRect();
    setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), t: timeAt(e.clientX) });
    if (scrub !== null) setScrub(timeAt(e.clientX));
  };
  const onSeekUp = (e: ReactPointerEvent) => {
    if (scrub === null) return;
    video().currentTime = timeAt(e.clientX);
    setTime(timeAt(e.clientX));
    setScrub(null);
  };

  const shown = scrub ?? time;
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  const volIcon = muted || volume === 0 ? 'mute' : volume < 0.5 ? 'volumeLow' : 'volume';

  return (
    <div
      ref={rootRef}
      className={`player ${chrome ? '' : 'is-idle'} ${fullscreen ? 'is-fullscreen' : ''}`}
      onMouseMove={wake}
      onMouseLeave={() => playing && !rootRef.current?.querySelector('.menu-panel') && setChrome(false)}
    >
      <video
        ref={videoRef}
        className="player-video"
        crossOrigin="anonymous"
        playsInline
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          const v = videoRef.current;
          if (v?.duration) propsRef.current.onProgress(v.currentTime, v.duration);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onError={(e) => {
          // hls.js reports its own errors; this covers files played directly (downloads).
          if (hlsRef.current) return;
          const code = e.currentTarget.error?.code;
          propsRef.current.onFatal(code === 4 ? 'The file is missing or isn’t a video PlayzAnime can play.' : 'The video stopped loading.');
        }}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onEnded={() => {
          if (!watchedSent.current) {
            watchedSent.current = true;
            props.onWatched();
          }
          if (hasNext && props.autoplayNext && !upNextDismissed.current) setUpNext((n) => n ?? 5);
          else if (hasNext) setUpNextIdle(true);
        }}
      >
        {stream.subtitles.map((s, i) => (
          <track key={s.url} ref={(el) => void (trackRefs.current[i] = el)} kind="subtitles" src={s.url} label={s.label} />
        ))}
      </video>

      <div className="player-cues" ref={cueRef} aria-live="off" />

      {waiting && (
        <div className="player-center">
          <Spinner size={38} />
        </div>
      )}
      {!playing && !waiting && upNext === null && !upNextIdle && (
        <button type="button" className="player-bigplay" aria-label="Play" onClick={toggle}>
          <Icon name="play" size={30} />
        </button>
      )}
      {flash && <div className="player-flash num">{flash}</div>}

      <div className="player-top">
        <div className="player-heading">
          <span className="player-series">{subtitle}</span>
          <span className="player-episode">{title}</span>
        </div>
      </div>

      {inIntro && !props.autoSkipIntro && (
        <button type="button" className="player-skip" onClick={skipIntro}>
          Skip intro <kbd>S</kbd>
        </button>
      )}
      {inOutro && hasNext && upNext === null && (
        <button type="button" className="player-skip" onClick={props.onNext}>
          Next episode
        </button>
      )}

      {(upNext !== null || upNextIdle) && hasNext && (
        <div className="player-upnext" role="dialog" aria-label="Up next">
          <span className="upnext-label">Up next</span>
          <span className="upnext-title clamp-2">{props.nextLabel}</span>
          <div className="upnext-actions">
            <button type="button" className="upnext-play" onClick={() => (setUpNext(null), props.onNext())}>
              <Icon name="play" size={16} />
              {upNext !== null && upNext > 0 ? `Playing in ${upNext}` : 'Play now'}
            </button>
            <button
              type="button"
              className="upnext-cancel"
              onClick={() => {
                upNextDismissed.current = true;
                setUpNext(null);
                setUpNextIdle(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="player-bottom">
        <div
          className={`seek ${scrub !== null ? 'is-scrubbing' : ''}`}
          ref={seekRef}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          onPointerLeave={() => setHover(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
          tabIndex={0}
        >
          <div className="seek-track">
            <span className="seek-buffer" style={{ width: pct(buffered) }} />
            {intro && duration > 0 && <span className="seek-chapter" style={{ left: pct(intro.start), width: pct(intro.end - intro.start) }} title="Intro" />}
            {outro && duration > 0 && <span className="seek-chapter" style={{ left: pct(outro.start), width: pct(Math.min(duration, outro.end) - outro.start) }} title="Credits" />}
            <span className="seek-played" style={{ width: pct(shown) }} />
            <span className="seek-thumb" style={{ left: pct(shown) }} />
          </div>
          {hover && duration > 0 && (
            <span className="seek-tip num" style={{ left: hover.x }}>
              {clock(hover.t)}
              {intro && hover.t >= intro.start && hover.t < intro.end && <em>Intro</em>}
              {outro && hover.t >= outro.start && hover.t < outro.end && <em>Credits</em>}
            </span>
          )}
        </div>

        <div className="player-bar">
          <button type="button" className="pbtn" aria-label={playing ? 'Pause (K)' : 'Play (K)'} title={playing ? 'Pause (K)' : 'Play (K)'} onClick={toggle}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <button type="button" className="pbtn" aria-label="Back 10 seconds (J)" title="Back 10 seconds (J)" onClick={() => seekBy(-10)}>
            <Icon name="back10" size={22} />
          </button>
          <button type="button" className="pbtn" aria-label="Forward 10 seconds (L)" title="Forward 10 seconds (L)" onClick={() => seekBy(10)}>
            <Icon name="fwd10" size={22} />
          </button>
          {hasNext && (
            <button type="button" className="pbtn" aria-label="Next episode (N)" title="Next episode (N)" onClick={props.onNext}>
              <Icon name="next" size={20} />
            </button>
          )}
          <div className="pvol">
            <button
              type="button"
              className="pbtn"
              aria-label={muted ? 'Unmute (M)' : 'Mute (M)'}
              title={muted ? 'Unmute (M)' : 'Mute (M)'}
              onClick={() => {
                const v = video();
                v.muted = !v.muted;
                if (!v.muted && v.volume === 0) setVol(0.6);
              }}
            >
              <Icon name={volIcon} size={21} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => setVol(Number(e.target.value))}
              style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>
          <span className="ptime num">
            {clock(shown)} <span className="faint">/ {clock(duration)}</span>
          </span>

          <div className="pspacer" />

          {stream.subtitles.length > 0 && (
            <Menu
              width={220}
              heading="Subtitles"
              items={[
                { key: 'off', label: 'Off', checked: subIndex === -1, onSelect: () => setSubIndex(-1) },
                ...stream.subtitles.map((s, i) => ({ key: s.url, label: s.label, checked: subIndex === i, onSelect: () => setSubIndex(i) })),
              ]}
              trigger={({ toggle: open }) => (
                <button type="button" className={`pbtn ${subIndex >= 0 ? 'is-on' : ''}`} aria-label="Subtitles (C)" title="Subtitles (C)" onClick={open}>
                  <Icon name="subtitles" size={21} />
                </button>
              )}
            />
          )}
          <Menu
            width={230}
            items={[
              ...(levels.length > 1
                ? [
                    { key: 'q-auto', label: 'Auto quality', checked: level === -1, onSelect: () => pickLevel(-1) },
                    ...levels.map((l) => ({ key: `q${l.index}`, label: `${l.height}p`, checked: level === l.index, onSelect: () => pickLevel(l.index) })),
                    'divider' as const,
                  ]
                : levels.length === 1
                  ? [{ key: 'q-only', label: `${levels[0].height}p`, hint: 'Only quality', disabled: true, onSelect: () => {} }, 'divider' as const]
                  : []),
              ...SPEEDS.map((s) => ({ key: `s${s}`, label: s === 1 ? 'Normal speed' : `${s}×`, checked: speed === s, onSelect: () => pickSpeed(s) })),
            ]}
            trigger={({ toggle: open }) => (
              <button type="button" className="pbtn" aria-label="Quality and speed" title="Quality and speed" onClick={open}>
                <Icon name="settings" size={20} />
              </button>
            )}
          />
          {!fullscreen && (
            <button type="button" className={`pbtn ${props.theater ? 'is-on' : ''}`} aria-label="Theater mode (T)" title="Theater mode (T)" onClick={props.onTheater}>
              <Icon name="theater" size={21} />
            </button>
          )}
          {document.pictureInPictureEnabled && (
            <button
              type="button"
              className="pbtn"
              aria-label="Picture in picture"
              title="Picture in picture"
              onClick={() => (document.pictureInPictureElement ? void document.exitPictureInPicture() : void video().requestPictureInPicture())}
            >
              <Icon name="pip" size={21} />
            </button>
          )}
          <button type="button" className="pbtn" aria-label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={toggleFullscreen}>
            <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
