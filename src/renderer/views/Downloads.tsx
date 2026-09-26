import { useMemo, useState, type ReactNode } from 'react';
import type { DirKind } from '../../shared/api';
import type { DownloadJob } from '../../shared/types';
import { Button, IconButton, Menu, ProgressBar } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Img } from '../components/Media';
import { EmptyState } from '../components/States';
import { useLoader } from '../lib/data';
import { bytes, countdown, relativeTime } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { useApp } from '../lib/store';
import './downloads.css';

const api = () => window.playzanime;
const ACTIVE = ['queued', 'resolving', 'downloading', 'muxing'];

function statusLine(j: DownloadJob): string {
  switch (j.state) {
    case 'queued':
      return 'Waiting for a free slot';
    case 'resolving':
      return j.stage ?? 'Getting ready';
    case 'downloading': {
      const parts = [`${Math.round(j.progress * 100)}%`];
      if (j.speed > 0) parts.push(`${bytes(j.speed)}/s`);
      if (j.speed > 0 && j.partsDone > 0 && j.partsTotal > j.partsDone) {
        const remaining = (j.bytes / j.partsDone) * (j.partsTotal - j.partsDone);
        parts.push(`about ${countdown(remaining / j.speed)} left`);
      }
      parts.push(`${bytes(j.bytes)} so far`);
      return parts.join(' · ');
    }
    case 'muxing':
      return j.stage ?? 'Finishing up';
    case 'done':
      return [j.kind === 'chapter' ? `${j.partsTotal} pages` : j.resolution, j.audio?.toUpperCase(), bytes(j.bytes), j.finishedAt ? relativeTime(j.finishedAt) : null].filter(Boolean).join(' · ');
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

export function Downloads() {
  const { downloads, settings, toast, online } = useApp();
  const active = downloads.filter((j) => ACTIVE.includes(j.state));
  const done = downloads.filter((j) => j.state === 'done');
  const failed = downloads.filter((j) => j.state === 'error' || j.state === 'cancelled');
  const groups = useMemo(() => groupBySeries(done), [done]);
  // Files moved or deleted outside the app are flagged rather than failing on play.
  const doneKey = done.map((j) => j.id).join(',');
  const missing = useLoader(`downloads:missing:${doneKey}`, () => api().downloads.missing(), 30_000);
  const missingSet = useMemo(() => new Set(missing.data ?? []), [missing.data]);

  const choose = async (kind: DirKind) => {
    const next = await api().settings.chooseDir(kind);
    if (next) toast(`${kind === 'manga' ? 'Manga' : 'Anime'} downloads now go to ${kind === 'manga' ? next.mangaDir : next.animeDir}`);
  };

  return (
    <div className="page downloads">
      <div className="page-head">
        <h1 className="page-title display">Downloads</h1>
        <p className="page-sub">Everything here plays and reads inside PlayzAnime, with or without internet. Files are MP4 and CBZ, so other players open them too.</p>
      </div>

      {!online && (
        <div className="offline-note">
          <Icon name="offline" size={20} />
          <div>
            <strong>You’re offline.</strong> Browsing and streaming come back when you reconnect. Your downloads below work right now.
          </div>
        </div>
      )}

      <div className="folders">
        <FolderRow kind="anime" path={settings.animeDir} onChange={() => void choose('anime')} />
        <FolderRow kind="manga" path={settings.mangaDir} onChange={() => void choose('manga')} />
      </div>

      {downloads.length === 0 ? (
        <EmptyState
          icon="downloads"
          title="Nothing downloaded yet"
          body="Pick Download on any episode or chapter to keep it for offline viewing. Downloads keep going while you browse."
          action={<Button onClick={() => navigate('/')}>Browse anime</Button>}
        />
      ) : (
        <>
          {active.length > 0 && (
            <Section title="In progress" count={active.length}>
              {active.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </Section>
          )}
          {failed.length > 0 && (
            <Section title="Needs attention" count={failed.length}>
              {failed.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </Section>
          )}
          {groups.length > 0 && (
            <section className="dl-section">
              <header className="dl-section-head">
                <h2 className="section-title">
                  On this device <span className="faint num">{done.length}</span>
                </h2>
                <span className="faint num">{bytes(done.reduce((n, j) => n + j.bytes, 0))}</span>
              </header>
              <div className="series-list">
                {groups.map((g) => (
                  <SeriesGroup key={`${g.media.type}:${g.media.id}`} group={g} missing={missingSet} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── On this device: series → episode/chapter → copies (quality, audio) ──

interface Unit {
  key: string;
  label: string;
  sort: number;
  copies: DownloadJob[];
}
interface Group {
  media: DownloadJob['media'];
  kind: 'episode' | 'chapter';
  units: Unit[];
  bytes: number;
  latest: number;
}

function groupBySeries(done: DownloadJob[]): Group[] {
  const groups = new Map<string, Group>();
  for (const j of done) {
    const key = `${j.kind}:${j.media.id}`;
    const g = groups.get(key) ?? { media: j.media, kind: j.kind, units: [], bytes: 0, latest: 0 };
    groups.set(key, g);
    g.bytes += j.bytes;
    g.latest = Math.max(g.latest, j.finishedAt ?? j.createdAt);
    const unitKey = j.kind === 'episode' ? `e${j.episode}` : `c${j.chapter?.number ?? j.id}`;
    let unit = g.units.find((u) => u.key === unitKey);
    if (!unit) {
      unit =
        j.kind === 'episode'
          ? { key: unitKey, label: `Episode ${j.episode}`, sort: j.episode ?? 0, copies: [] }
          : { key: unitKey, label: j.chapter?.number ? `Chapter ${j.chapter.number}` : j.label, sort: Number(j.chapter?.number ?? 0), copies: [] };
      g.units.push(unit);
    }
    unit.copies.push(j);
  }
  for (const g of groups.values()) {
    g.units.sort((a, b) => a.sort - b.sort);
    for (const u of g.units) u.copies.sort((a, b) => (parseInt(b.resolution ?? '0', 10) || 0) - (parseInt(a.resolution ?? '0', 10) || 0));
  }
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
}

function SeriesGroup({ group, missing }: { group: Group; missing: Set<string> }) {
  const [open, setOpen] = useState(true);
  const anime = group.kind === 'episode';
  const count = group.units.length;
  const detailPath = anime ? `/anime/${group.media.id}` : `/manga/${group.media.id}`;
  const play = (j: DownloadJob) => navigate(anime ? `/offline/watch/${encodeURIComponent(j.id)}` : `/offline/read/${encodeURIComponent(j.id)}`);

  return (
    <div className={`series ${open ? 'is-open' : ''}`}>
      <div className="series-head">
        <Link to={detailPath} className="series-cover" tabIndex={-1} aria-hidden="true">
          <Img src={group.media.cover} color={group.media.color} />
        </Link>
        <button type="button" className="series-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="series-name clamp-1">{group.media.title}</span>
          <span className="series-meta num">
            {anime ? 'Anime' : 'Manga'} · {count} {anime ? (count === 1 ? 'episode' : 'episodes') : count === 1 ? 'chapter' : 'chapters'} · {bytes(group.bytes)}
          </span>
        </button>
        <Button variant="solid" size="sm" icon={anime ? 'play' : 'manga'} onClick={() => play(group.units[0].copies[0])}>
          {anime ? 'Play' : 'Read'}
        </Button>
        <IconButton icon="chevronDown" size={17} label={open ? 'Collapse' : 'Expand'} className="series-toggle" onClick={() => setOpen((o) => !o)} />
      </div>
      {open && (
        <div className="units">
          {group.units.map((u) => (
            <div key={u.key} className="unit">
              <span className="unit-label num">{u.label}</span>
              <div className="copies">
                {u.copies.map((j) => (
                  <Copy key={j.id} job={j} missing={missing.has(j.id)} onPlay={() => play(j)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Copy({ job, missing, onPlay }: { job: DownloadJob; missing: boolean; onPlay: () => void }) {
  const { toast } = useApp();
  const anime = job.kind === 'episode';
  const label = anime ? [job.resolution, job.audio?.toUpperCase()].filter(Boolean).join(' ') || 'Video' : `${job.partsTotal} pages`;
  const openElsewhere = async () => {
    if (!(await api().downloads.open(job.id))) toast('That file has been moved or deleted.', { tone: 'error' });
  };
  return (
    <div className={`copy ${missing ? 'is-missing' : ''}`}>
      <button
        type="button"
        className="copy-play"
        onClick={() => (missing ? toast('This file was moved or deleted outside PlayzAnime. Remove it here, or download it again.', { tone: 'error' }) : onPlay())}
        title={missing ? `Missing: ${job.outputFile}` : anime ? 'Play in PlayzAnime' : 'Read in PlayzAnime'}
      >
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

function FolderRow({ kind, path, onChange }: { kind: DirKind; path: string; onChange: () => void }) {
  return (
    <div className="folder">
      <Icon name={kind === 'manga' ? 'manga' : 'tv'} size={19} />
      <div className="folder-text">
        <span className="folder-label">{kind === 'manga' ? 'Manga chapters' : 'Anime episodes'}</span>
        <span className="folder-path" title={path}>
          {path}
        </span>
      </div>
      <Button variant="quiet" size="sm" icon="folder" onClick={() => void api().app.openDir(kind)}>
        Open
      </Button>
      <Button variant="ghost" size="sm" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="dl-section">
      <header className="dl-section-head">
        <h2 className="section-title">
          {title} <span className="faint num">{count}</span>
        </h2>
        {action}
      </header>
      <div className="dl-list">{children}</div>
    </section>
  );
}

function JobRow({ job }: { job: DownloadJob }) {
  const { toast } = useApp();
  const running = ACTIVE.includes(job.state);
  const openTarget = job.kind === 'chapter' ? `/manga/${job.media.id}` : `/anime/${job.media.id}`;

  const open = async () => {
    if (!(await api().downloads.open(job.id))) toast('That file has been moved or deleted.', { tone: 'error' });
  };

  return (
    <div className={`job is-${job.state}`}>
      <Link to={openTarget} className="job-cover" tabIndex={-1} aria-hidden="true">
        <Img src={job.media.cover} color={job.media.color} />
      </Link>
      <div className="job-main">
        <div className="job-title">
          <Link to={openTarget}>{job.media.title}</Link>
          <span className="job-label clamp-1">{job.label}</span>
        </div>
        {running && <ProgressBar value={job.state === 'queued' ? 0 : job.progress} className={`job-progress ${job.state === 'resolving' ? 'is-waiting' : ''}`} />}
        <div className={`job-status num ${job.state === 'error' ? 'is-error' : ''}`}>
          {job.state === 'error' && <Icon name="alert" size={14} />}
          {statusLine(job)}
        </div>
      </div>
      <div className="job-actions">
        {running && (
          <Button variant="ghost" size="sm" onClick={() => void api().downloads.cancel(job.id)}>
            Cancel
          </Button>
        )}
        {(job.state === 'error' || job.state === 'cancelled') && (
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void api().downloads.retry(job.id)}>
            {job.partsDone > 0 ? 'Resume' : 'Retry'}
          </Button>
        )}
        {job.state === 'done' && (
          <>
            <Button variant="solid" size="sm" icon={job.kind === 'chapter' ? 'manga' : 'play'} onClick={() => void open()}>
              Open
            </Button>
            <IconButton icon="folder" size={17} label="Show in folder" onClick={() => void api().downloads.reveal(job.id)} />
          </>
        )}
        {!running && (
          <Menu
            width={210}
            items={[
              { key: 'remove', label: 'Remove from list', icon: 'close', onSelect: () => void api().downloads.remove(job.id) },
              ...(job.state === 'done'
                ? [{ key: 'delete', label: 'Delete the file too', icon: 'trash' as const, danger: true, onSelect: () => void api().downloads.remove(job.id, true) }]
                : []),
            ]}
            trigger={({ toggle, open: isOpen, id }) => <IconButton icon="more" size={17} label="More" aria-expanded={isOpen} aria-controls={id} onClick={toggle} />}
          />
        )}
      </div>
    </div>
  );
}
