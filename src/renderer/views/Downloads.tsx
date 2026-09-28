import { useEffect, useMemo, useState } from 'react';
import type { DirKind } from '../../shared/api';
import type { DownloadJob } from '../../shared/types';
import { Button, IconButton, Menu, ProgressBar, Select, Tabs } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Img } from '../components/Media';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/States';
import { useLoader } from '../lib/data';
import { bytes, countdown, relativeTime } from '../lib/format';
import { navigate } from '../lib/router';
import { useApp } from '../lib/store';
import './downloads.css';

/*
 * Downloads, arranged like a home page: the queue at the top with controls for all of it,
 * then everything on this device as a shelf of covers, split into anime, manga, manhwa and
 * manhua. Downloads are grouped by series, so 3,000 chapters of one manhwa are one card.
 */

const api = () => window.playzanime;
const RUNNING = ['resolving', 'downloading', 'muxing'];
const UNFINISHED = ['queued', 'resolving', 'downloading', 'muxing', 'paused', 'error', 'cancelled'];
const ITEMS_SHOWN = 60;
/** The automatic look through the download folders runs once per app session. */
let scannedThisSession = false;

type Shelf = 'all' | 'anime' | 'manga' | 'manhwa' | 'manhua';
const SHELF_NAMES: Record<Exclude<Shelf, 'all'>, string> = { anime: 'Anime', manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };

interface Series {
  key: string;
  media: DownloadJob['media'];
  kind: 'episode' | 'chapter';
  shelf: Exclude<Shelf, 'all'>;
  queue: DownloadJob[];
  done: DownloadJob[];
  latest: number;
}

const shelfOf = (kind: DownloadJob['kind'], country: string | null | undefined): Series['shelf'] =>
  kind === 'episode' ? 'anime' : country === 'KR' ? 'manhwa' : country === 'CN' || country === 'TW' ? 'manhua' : 'manga';

/** Downloads saved before countries were recorded: look each series up once (AniList, cached). */
function useCountries(ids: number[]): Map<number, string> {
  const [found, setFound] = useState<Map<number, string>>(new Map());
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const id of ids) {
        if (found.has(id)) continue;
        try {
          const m = await api().anilist.media(id, 'MANGA');
          if (!live) return;
          if (m.countryOfOrigin) setFound((prev) => new Map(prev).set(id, m.countryOfOrigin!));
        } catch {
          /* offline: it stays under Manga */
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return found;
}

function groupSeries(jobs: DownloadJob[], countries: Map<number, string>): Series[] {
  const map = new Map<string, Series>();
  for (const j of jobs) {
    const key = `${j.kind}:${j.media.id}`;
    let s = map.get(key);
    if (!s) {
      s = { key, media: j.media, kind: j.kind, shelf: shelfOf(j.kind, j.media.country ?? countries.get(j.media.id)), queue: [], done: [], latest: 0 };
      map.set(key, s);
    }
    if (j.state === 'done') s.done.push(j);
    else if (UNFINISHED.includes(j.state)) s.queue.push(j);
    s.latest = Math.max(s.latest, j.finishedAt ?? j.createdAt);
  }
  return [...map.values()].sort((a, b) => b.latest - a.latest);
}

export function Downloads() {
  const { downloads, settings, updateSettings, toast, online } = useApp();
  const [shelf, setShelf] = useState<Shelf>('all');
  const [confirmCancel, setConfirmCancel] = useState<{ ids?: string[]; title: string } | null>(null);

  const missingCountry = useMemo(
    () => [...new Set(downloads.filter((j) => j.kind === 'chapter' && !j.media.country).map((j) => j.media.id))],
    [downloads],
  );
  const countries = useCountries(missingCountry);
  const series = useMemo(() => groupSeries(downloads, countries), [downloads, countries]);
  const inShelf = shelf === 'all' ? series : series.filter((s) => s.shelf === shelf);
  const queue = inShelf.filter((s) => s.queue.length);
  const library = inShelf.filter((s) => s.done.length);

  const unfinished = downloads.filter((j) => UNFINISHED.includes(j.state));
  const running = unfinished.filter((j) => RUNNING.includes(j.state));
  const waiting = unfinished.filter((j) => j.state === 'queued');
  const paused = unfinished.filter((j) => j.state === 'paused');
  const failed = unfinished.filter((j) => j.state === 'error' || j.state === 'cancelled');

  const counts = useMemo(() => {
    const c: Record<Shelf, number> = { all: series.length, anime: 0, manga: 0, manhwa: 0, manhua: 0 };
    for (const s of series) c[s.shelf]++;
    return c;
  }, [series]);

  const done = downloads.filter((j) => j.state === 'done');
  const doneKey = done.length;
  const missing = useLoader(`downloads:missing:${doneKey}`, () => api().downloads.missing(), 30_000);
  const missingSet = useMemo(() => new Set(missing.data ?? []), [missing.data]);

  const [scanning, setScanning] = useState(false);
  const scan = async (quiet = false) => {
    setScanning(true);
    try {
      const added = await api().downloads.rescan();
      if (!quiet || added) toast(added ? `Found ${added.toLocaleString()} ${added === 1 ? 'download' : 'downloads'} in your folders` : 'Everything in your folders is already here');
    } finally {
      setScanning(false);
    }
  };
  // Nothing finished in the list but files may be on disk (a lost list, a reinstall): look once.
  useEffect(() => {
    if (scannedThisSession || done.length > 0) return;
    scannedThisSession = true;
    void scan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (kind: DirKind) => {
    const next = await api().settings.chooseDir(kind);
    if (next) toast(`${kind === 'manga' ? 'Manga' : 'Anime'} downloads now go to ${kind === 'manga' ? next.mangaDir : next.animeDir}`);
  };

  return (
    <div className="page downloads">
      <div className="page-head dl-head">
        <div>
          <h1 className="page-title display">Downloads</h1>
          <p className="page-sub">Everything here plays and reads inside PlayzAnime, with or without internet.</p>
        </div>
        <div className="dl-folders">
          <Button variant="quiet" size="sm" icon="refresh" disabled={scanning} onClick={() => void scan()} title="Adds episodes and chapters in your download folders that aren't listed here">
            {scanning ? 'Looking…' : 'Find downloads in my folders'}
          </Button>
          <FolderButton kind="anime" path={settings.animeDir} onChange={() => void choose('anime')} />
          <FolderButton kind="manga" path={settings.mangaDir} onChange={() => void choose('manga')} />
        </div>
      </div>

      {!online && (
        <div className="offline-note">
          <Icon name="offline" size={20} />
          <div>
            <strong>You’re offline.</strong> Everything on this device below plays and reads right now. Downloads continue when you reconnect.
          </div>
        </div>
      )}

      {downloads.length === 0 ? (
        <EmptyState
          icon="downloads"
          title="Nothing downloaded yet"
          body="Pick Download on any episode or chapter to keep it for offline viewing. Downloads keep going while you browse."
          action={<Button onClick={() => navigate('/')}>Browse anime</Button>}
        />
      ) : (
        <>
          {unfinished.length > 0 && (
            <section className="dl-control" aria-label="Download queue">
              <div className="dl-control-status">
                <strong className="num">
                  {running.length > 0 ? `Downloading ${running.length}` : paused.length ? 'Paused' : waiting.length ? 'Starting' : 'Stopped'}
                </strong>
                <span className="faint num">
                  {[waiting.length && `${waiting.length.toLocaleString()} waiting`, paused.length && `${paused.length.toLocaleString()} paused`, failed.length && `${failed.length} failed`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="dl-control-actions">
                <label className="dl-atonce">
                  <span className="faint">At once</span>
                  <Select
                    label="Downloads at once"
                    value={settings.maxDownloads ?? 3}
                    width={76}
                    onChange={(v) => void updateSettings({ maxDownloads: v })}
                    options={[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: n, label: String(n) }))}
                  />
                </label>
                {running.length + waiting.length > 0 ? (
                  <Button variant="ghost" size="sm" icon="pause" onClick={() => void api().downloads.pauseMany()}>
                    Pause all
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" icon="play" onClick={() => void api().downloads.resumeMany()}>
                    Resume all
                  </Button>
                )}
                {running.length + waiting.length > 0 && paused.length + failed.length > 0 && (
                  <Button variant="ghost" size="sm" icon="play" onClick={() => void api().downloads.resumeMany()}>
                    Resume the rest
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirmCancel({ title: `all ${unfinished.length.toLocaleString()} unfinished downloads` })}>
                  Cancel all
                </Button>
              </div>
            </section>
          )}

          <Tabs
            className="dl-tabs"
            label="Kind"
            value={shelf}
            onChange={setShelf}
            options={(['all', 'anime', 'manga', 'manhwa', 'manhua'] as Shelf[])
              .filter((s) => s === 'all' || counts[s] > 0)
              .map((s) => ({ value: s, label: s === 'all' ? 'Everything' : SHELF_NAMES[s], count: counts[s] }))}
          />

          {queue.length > 0 && (
            <section className="dl-section">
              <h2 className="section-title">
                In progress <span className="faint num">{queue.reduce((n, s) => n + s.queue.length, 0).toLocaleString()}</span>
              </h2>
              <div className="queue-list">
                {queue.map((s) => (
                  <QueueCard key={s.key} series={s} onCancel={(ids, title) => setConfirmCancel({ ids, title })} />
                ))}
              </div>
            </section>
          )}

          {library.length > 0 ? (
            <section className="dl-section">
              <h2 className="section-title">
                On this device <span className="faint num">{library.length}</span>
                <span className="dl-size faint num">{bytes(library.reduce((n, s) => n + s.done.reduce((m, j) => m + j.bytes, 0), 0))}</span>
              </h2>
              <Library series={library} missing={missingSet} />
            </section>
          ) : (
            queue.length === 0 && <p className="faint dl-none">Nothing here yet.</p>
          )}
        </>
      )}

      <Modal
        open={confirmCancel !== null}
        onClose={() => setConfirmCancel(null)}
        title="Cancel downloads?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmCancel(null)}>
              Keep them
            </Button>
            <Button
              variant="primary"
              icon="trash"
              onClick={() => {
                void api().downloads.cancelMany(confirmCancel?.ids);
                setConfirmCancel(null);
                toast('Cancelled');
              }}
            >
              Cancel and delete
            </Button>
          </>
        }
      >
        <p className="muted">
          This stops and deletes {confirmCancel?.title}, including anything they had saved so far. Finished downloads stay.
        </p>
      </Modal>
    </div>
  );
}

// ── The queue: one card per series ──────────────────────────────────────────

function QueueCard({ series, onCancel }: { series: Series; onCancel: (ids: string[], title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const { queue, done, media } = series;
  const anime = series.kind === 'episode';
  const unit = (n: number) => (anime ? (n === 1 ? 'episode' : 'episodes') : n === 1 ? 'chapter' : 'chapters');

  const running = queue.filter((j) => RUNNING.includes(j.state));
  const waiting = queue.filter((j) => j.state === 'queued');
  const paused = queue.filter((j) => j.state === 'paused');
  const failed = queue.filter((j) => j.state === 'error' || j.state === 'cancelled');
  const total = done.length + queue.length;
  const progress = total ? (done.length + running.reduce((n, j) => n + j.progress, 0)) / total : 0;
  const ids = queue.map((j) => j.id);
  const active = running.length + waiting.length > 0;
  // In episode or chapter order; a batch is queued all at once, so time can't order it.
  const orderOf = (j: DownloadJob) => (j.kind === 'episode' ? (j.episode ?? 0) : Number(j.chapter?.number ?? 0));
  const items = [...queue].sort((a, b) => orderOf(a) - orderOf(b) || a.createdAt - b.createdAt);
  const shown = all ? items : items.slice(0, ITEMS_SHOWN);

  return (
    <div className={`queue-card ${open ? 'is-open' : ''}`}>
      <div className="queue-head">
        <span className="queue-cover" aria-hidden="true">
          <Img src={media.cover} color={media.color} />
        </span>
        <div className="queue-main">
          <div className="queue-title">
            <span className="clamp-1">{media.title}</span>
            <span className="queue-tag">{SHELF_NAMES[series.shelf]}</span>
          </div>
          <ProgressBar value={progress} className="queue-progress" />
          <div className="queue-meta num">
            <span>
              {done.length.toLocaleString()} of {total.toLocaleString()} {unit(total)}
            </span>
            {running.length > 0 && <span>Now: {running.map((j) => `${j.label.split(' · ')[0]} ${Math.round(j.progress * 100)}%`).join(', ')}</span>}
            {waiting.length > 0 && <span>{waiting.length.toLocaleString()} waiting</span>}
            {paused.length > 0 && <span>{paused.length.toLocaleString()} paused</span>}
            {failed.length > 0 && <span className="is-error">{failed.length} failed</span>}
          </div>
        </div>
        <div className="queue-actions">
          {active ? (
            <Button variant="ghost" size="sm" icon="pause" onClick={() => void api().downloads.pauseMany(ids)}>
              Pause
            </Button>
          ) : (
            <Button variant="solid" size="sm" icon="play" onClick={() => void api().downloads.resumeMany(ids)}>
              {failed.length && !paused.length ? 'Retry' : 'Resume'}
            </Button>
          )}
          <Button variant="quiet" size="sm" onClick={() => onCancel(ids, `${queue.length.toLocaleString()} ${unit(queue.length)} of ${media.title}`)}>
            Cancel
          </Button>
          <IconButton icon="chevronDown" size={17} label={open ? 'Hide items' : 'Show items'} className="queue-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
        </div>
      </div>

      {open && (
        <div className="queue-items">
          {shown.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
          {items.length > shown.length && (
            <button type="button" className="queue-more" onClick={() => setAll(true)}>
              Show all {items.length.toLocaleString()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function statusLine(j: DownloadJob): string {
  switch (j.state) {
    case 'queued':
      return 'Waiting';
    case 'paused':
      return j.partsDone > 0 && j.partsTotal > 0 ? `Paused at ${Math.round((j.partsDone / j.partsTotal) * 100)}%` : 'Paused';
    case 'resolving':
      return j.stage ?? 'Getting ready';
    case 'downloading': {
      const parts = [`${Math.round(j.progress * 100)}%`];
      if (j.speed > 0) parts.push(`${bytes(j.speed)}/s`);
      if (j.speed > 0 && j.partsDone > 0 && j.partsTotal > j.partsDone) {
        const remaining = (j.bytes / j.partsDone) * (j.partsTotal - j.partsDone);
        parts.push(`about ${countdown(remaining / j.speed)} left`);
      }
      return parts.join(' · ');
    }
    case 'muxing':
      return j.stage ?? 'Finishing up';
    case 'done':
      return j.finishedAt ? `Finished ${relativeTime(j.finishedAt)}` : 'Finished';
    case 'cancelled':
      return 'Cancelled';
    case 'error':
      return friendlyJobError(j);
  }
}

/** Raw transport errors (with signed URLs in them) mean nothing to people; say what happened. */
function friendlyJobError(j: DownloadJob): string {
  const e = j.error ?? '';
  const saved = j.partsDone > 0 && j.partsTotal > 0 ? ` ${Math.round((j.partsDone / j.partsTotal) * 100)}% is saved.` : '';
  if (/ENOSPC|no space left/i.test(e)) return `Your disk is full.${saved} Free some space, then Resume.`;
  if (/EPERM|EACCES|operation not permitted|didn.t let PlayzAnime/i.test(e))
    return `Windows blocked saving to your download folder.${saved} Allow PlayzAnime under Settings → Downloads, or pick another folder, then Resume.`;
  if (/HTTP 429/.test(e)) return `The video host is limiting downloads right now.${saved} Resume in a minute or two.`;
  if (/HTTP 40[13]/.test(e)) return `The stream link expired.${saved} Resume fetches a fresh one.`;
  const http = /HTTP (\d{3})/.exec(e);
  if (http) return `The host answered ${http[1]}.${saved} Try Resume.`;
  if (/fetch failed|ECONN|ENOTFOUND|timed? ?out|network/i.test(e)) return `Connection dropped.${saved} Resume when you’re back online.`;
  return `${e || 'Failed.'}${saved}`;
}

function JobRow({ job }: { job: DownloadJob }) {
  const running = RUNNING.includes(job.state);
  const canResume = job.state === 'paused' || job.state === 'error' || job.state === 'cancelled';
  return (
    <div className={`job is-${job.state}`}>
      <span className="job-label num clamp-1">{job.label}</span>
      {running ? <ProgressBar value={job.progress} className="job-progress" /> : <span className="job-spacer" />}
      <span className={`job-status num ${job.state === 'error' ? 'is-error' : ''}`} title={job.state === 'error' ? friendlyJobError(job) : undefined}>
        {job.state === 'error' && <Icon name="alert" size={13} />}
        {statusLine(job)}
      </span>
      <span className="job-actions">
        {(running || job.state === 'queued') && <IconButton icon="pause" size={15} label="Pause" onClick={() => void api().downloads.pause(job.id)} />}
        {canResume && <IconButton icon="play" size={15} label={job.state === 'paused' ? 'Resume' : 'Retry'} onClick={() => void api().downloads.retry(job.id)} />}
        <IconButton icon="close" size={15} label="Cancel and delete" onClick={() => void api().downloads.cancel(job.id)} />
      </span>
    </div>
  );
}

// ── On this device: a shelf of covers, opened like the series page ─────────

function Library({ series, missing }: { series: Series[]; missing: Set<string> }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = series.find((s) => s.key === openKey) ?? null;
  return (
    <>
      <div className="shelf">
        {series.map((s) => {
          const anime = s.kind === 'episode';
          const n = unitCount(s.done);
          return (
            <button key={s.key} type="button" className={`shelf-card ${openKey === s.key ? 'is-open' : ''}`} onClick={() => setOpenKey(openKey === s.key ? null : s.key)}>
              <span className="shelf-cover">
                <Img src={s.media.cover} color={s.media.color} />
                <span className="shelf-count num">
                  {n.toLocaleString()} {anime ? (n === 1 ? 'ep' : 'eps') : n === 1 ? 'ch' : 'chs'}
                </span>
              </span>
              <span className="shelf-title clamp-2">{s.media.title}</span>
              <span className="shelf-meta faint num">
                {SHELF_NAMES[s.shelf]} · {bytes(s.done.reduce((m, j) => m + j.bytes, 0))}
              </span>
            </button>
          );
        })}
      </div>
      {opened && <SeriesPanel key={opened.key} series={opened} missing={missing} onClose={() => setOpenKey(null)} />}
    </>
  );
}

interface Unit {
  key: string;
  label: string;
  sort: number;
  copies: DownloadJob[];
}

function unitsOf(done: DownloadJob[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const j of done) {
    const key = j.kind === 'episode' ? `e${j.episode}` : `c${j.chapter?.number ?? j.id}`;
    let u = units.get(key);
    if (!u) {
      u =
        j.kind === 'episode'
          ? { key, label: `Episode ${j.episode}`, sort: j.episode ?? 0, copies: [] }
          : { key, label: j.chapter?.number ? `Chapter ${j.chapter.number}` : j.label, sort: Number(j.chapter?.number ?? 0), copies: [] };
      units.set(key, u);
    }
    u.copies.push(j);
  }
  const list = [...units.values()].sort((a, b) => a.sort - b.sort);
  for (const u of list) u.copies.sort((a, b) => (parseInt(b.resolution ?? '0', 10) || 0) - (parseInt(a.resolution ?? '0', 10) || 0));
  return list;
}

const unitCount = (done: DownloadJob[]) => new Set(done.map((j) => (j.kind === 'episode' ? `e${j.episode}` : `c${j.chapter?.number ?? j.id}`))).size;

/** A downloaded series opened: continue, pick any episode or chapter, find one by number. */
function SeriesPanel({ series, missing, onClose }: { series: Series; missing: Set<string>; onClose: () => void }) {
  const { toast } = useApp();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const anime = series.kind === 'episode';
  const units = useMemo(() => unitsOf(series.done), [series.done]);
  const q = query.trim();
  const matches = q ? units.filter((u) => u.label.toLowerCase().includes(q.toLowerCase())) : units;
  const shown = all || q ? matches : matches.slice(0, 120);

  const open = (j: DownloadJob) => {
    if (missing.has(j.id)) return toast('This file was moved or deleted outside PlayzAnime. Remove it here, or download it again.', { tone: 'error' });
    navigate(anime ? `/offline/watch/${encodeURIComponent(j.id)}` : `/offline/read/${encodeURIComponent(j.id)}`);
  };

  return (
    <div className="panel-series">
      <div className="panel-series-head">
        <span className="panel-series-cover">
          <Img src={series.media.cover} color={series.media.color} />
        </span>
        <div className="panel-series-text">
          <h3 className="display">{series.media.title}</h3>
          <p className="faint num">
            {SHELF_NAMES[series.shelf]} · {units.length.toLocaleString()} {anime ? 'episodes' : 'chapters'} on this device · {bytes(series.done.reduce((m, j) => m + j.bytes, 0))}
          </p>
          <div className="panel-series-actions">
            <Button variant="primary" icon={anime ? 'play' : 'manga'} onClick={() => units[0] && open(units[0].copies[0])}>
              {anime ? `Play ${units[0]?.label ?? ''}` : `Read ${units[0]?.label ?? ''}`}
            </Button>
            {series.media.id > 0 && (
              <Button variant="ghost" onClick={() => navigate(anime ? `/anime/${series.media.id}` : `/manga/${series.media.id}`)}>
                Series page
              </Button>
            )}
          </div>
        </div>
        <IconButton icon="close" size={18} label="Close" className="panel-series-close" onClick={onClose} />
      </div>

      <div className="panel-series-tools">
        <label className="dl-find">
          <Icon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={anime ? 'Find an episode' : 'Find a chapter, like 3844'} aria-label="Find" />
        </label>
      </div>

      <div className="units">
        {shown.map((u) => (
          <div key={u.key} className="unit">
            <span className="unit-label num">{u.label}</span>
            <div className="copies">
              {u.copies.map((j) => (
                <Copy key={j.id} job={j} missing={missing.has(j.id)} onOpen={() => open(j)} />
              ))}
            </div>
          </div>
        ))}
        {matches.length > shown.length && (
          <button type="button" className="queue-more" onClick={() => setAll(true)}>
            Show all {matches.length.toLocaleString()}
          </button>
        )}
      </div>
    </div>
  );
}

function Copy({ job, missing, onOpen }: { job: DownloadJob; missing: boolean; onOpen: () => void }) {
  const { toast } = useApp();
  const anime = job.kind === 'episode';
  const label = anime ? [job.resolution, job.audio?.toUpperCase()].filter(Boolean).join(' ') || 'Video' : job.partsTotal ? `${job.partsTotal} pages` : 'CBZ';
  const openElsewhere = async () => {
    if (!(await api().downloads.open(job.id))) toast('That file has been moved or deleted.', { tone: 'error' });
  };
  return (
    <div className={`copy ${missing ? 'is-missing' : ''}`}>
      <button type="button" className="copy-play" onClick={onOpen} title={missing ? `Missing: ${job.outputFile}` : anime ? 'Play in PlayzAnime' : 'Read in PlayzAnime'}>
        <Icon name={missing ? 'alert' : anime ? 'play' : 'manga'} size={13} />
        <span className="num">{label}</span>
        <span className="copy-size num">{missing ? 'Missing' : bytes(job.bytes)}</span>
      </button>
      <Menu
        width={236}
        items={[
          { key: 'open', label: anime ? 'Open in another player' : 'Open in another reader', icon: 'external', onSelect: () => void openElsewhere() },
          { key: 'reveal', label: 'Show in folder', icon: 'folder', onSelect: () => void api().downloads.reveal(job.id) },
          { key: 'remove', label: 'Remove from PlayzAnime (keep file)', icon: 'close', onSelect: () => void api().downloads.remove(job.id) },
          { key: 'delete', label: 'Delete the file', icon: 'trash', danger: true, onSelect: () => void api().downloads.remove(job.id, true) },
        ]}
        trigger={({ toggle, open, id }) => <IconButton icon="more" size={15} label="More" className="copy-more" aria-expanded={open} aria-controls={id} onClick={toggle} />}
      />
    </div>
  );
}

function FolderButton({ kind, path, onChange }: { kind: DirKind; path: string; onChange: () => void }) {
  return (
    <Menu
      width={260}
      heading={path}
      items={[
        { key: 'open', label: 'Open folder', icon: 'folder', onSelect: () => void api().app.openDir(kind) },
        { key: 'change', label: 'Change folder…', icon: 'settings', onSelect: onChange },
      ]}
      trigger={({ toggle, open, id }) => (
        <Button variant="ghost" size="sm" icon={kind === 'manga' ? 'manga' : 'tv'} aria-expanded={open} aria-controls={id} onClick={toggle} title={path}>
          {kind === 'manga' ? 'Manga folder' : 'Anime folder'}
        </Button>
      )}
    />
  );
}
