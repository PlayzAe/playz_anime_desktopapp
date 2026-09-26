import { useMemo, useState } from 'react';
import type { HistoryEntry, ListStatus, ReadingEntry } from '../../shared/types';
import { Button, IconButton, Segmented, Tabs } from '../components/Controls';
import { statusLabel } from '../components/ListButton';
import { fromSnapshot, Img, PosterCard } from '../components/Media';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/States';
import { clock, relativeTime } from '../lib/format';
import { Link, navigate, useRoute, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import './library.css';

type Tab = ListStatus | 'history';
type Kind = 'all' | 'ANIME' | 'MANGA';

const STATUSES: ListStatus[] = ['watching', 'planning', 'completed', 'paused', 'dropped'];

type Activity = { kind: 'watch'; entry: HistoryEntry } | { kind: 'read'; entry: ReadingEntry };

export function Library() {
  const route = useRoute();
  const { library, history, reading, removeHistory, removeReading, clearAllHistory } = useApp();
  const tab = (route.query.get('tab') as Tab) || 'watching';
  const kind = (route.query.get('type') as Kind) || 'all';
  const [confirmClear, setConfirmClear] = useState(false);

  const go = (patch: { tab?: Tab; type?: Kind }) =>
    navigate(withQuery('/library', { tab: patch.tab ?? tab, type: (patch.type ?? kind) === 'all' ? null : (patch.type ?? kind) }), { replace: true });

  const ofKind = useMemo(() => library.filter((e) => kind === 'all' || e.media.type === kind), [library, kind]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of ofKind) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [ofKind]);

  const activity = useMemo<Activity[]>(
    () =>
      [
        ...(kind !== 'MANGA' ? history.map((entry) => ({ kind: 'watch' as const, entry })) : []),
        ...(kind !== 'ANIME' ? reading.map((entry) => ({ kind: 'read' as const, entry })) : []),
      ].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt),
    [history, reading, kind],
  );

  const entries = ofKind.filter((e) => e.status === tab);
  const manga = kind === 'MANGA';

  return (
    <div className="page library">
      <div className="page-head library-head">
        <div>
          <h1 className="page-title display">Library</h1>
          <p className="page-sub">
            {library.length ? `${library.length} ${library.length === 1 ? 'title' : 'titles'} saved on this computer.` : 'Your lists live on this computer. Nothing is shared.'}
          </p>
        </div>
        <Segmented
          label="Type"
          value={kind}
          onChange={(v) => go({ type: v })}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'ANIME', label: 'Anime' },
            { value: 'MANGA', label: 'Manga' },
          ]}
        />
      </div>

      <Tabs
        label="Lists"
        className="library-tabs"
        value={tab}
        onChange={(t) => go({ tab: t })}
        options={[
          ...STATUSES.map((s) => ({ value: s as Tab, label: s === 'watching' && kind === 'all' ? 'Watching & reading' : statusLabel(s, manga), count: counts[s] ?? 0 })),
          { value: 'history', label: 'History', count: activity.length },
        ]}
      />

      <div className="library-body">
        {tab === 'history' ? (
          activity.length === 0 ? (
            <EmptyState icon="history" title="No history yet" body="Episodes you watch and chapters you read show up here, newest first." />
          ) : (
            <>
              <div className="history-list">
                {activity.map((a) => (a.kind === 'watch' ? <WatchRow key={`w${a.entry.media.id}`} h={a.entry} onRemove={() => void removeHistory(a.entry.media.id)} /> : <ReadRow key={`r${a.entry.media.id}`} r={a.entry} onRemove={() => void removeReading(a.entry.media.id)} />))}
              </div>
              <div className="history-foot">
                <Button variant="quiet" size="sm" icon="trash" onClick={() => setConfirmClear(true)}>
                  Clear all history
                </Button>
              </div>
            </>
          )
        ) : entries.length === 0 ? (
          <EmptyState
            icon="library"
            title={`Nothing in ${statusLabel(tab, manga).toLowerCase()}`}
            body={tab === 'planning' ? 'Use “Add to library” on any show or manga to plan it for later.' : 'Titles move here when you set their status from their page.'}
            action={<Button onClick={() => navigate(kind === 'MANGA' ? '/manga' : '/discover')}>Find something</Button>}
          />
        ) : (
          <div className="poster-grid">
            {entries.map((e) => (
              <PosterCard key={e.media.id} media={fromSnapshot(e.media)} meta={<LibraryMeta id={e.media.id} type={e.media.type} total={e.media.type === 'MANGA' ? e.media.chapters : e.media.episodes} />} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all history?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmClear(false)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              icon="trash"
              onClick={() => {
                void clearAllHistory();
                setConfirmClear(false);
              }}
            >
              Clear history
            </Button>
          </>
        }
      >
        <p className="muted">This removes every resume point, watched episode and read chapter. Your library lists and downloaded files stay.</p>
      </Modal>
    </div>
  );
}

function LibraryMeta({ id, type, total }: { id: number; type: string; total?: number | null }) {
  const { historyFor, readingFor } = useApp();
  if (type === 'MANGA') {
    const r = readingFor(id);
    return <span className="num">{r?.chapterNumber ? `Ch. ${r.chapterNumber}${total ? ` of ${total}` : ''}` : total ? `${total} chapters` : 'Manga'}</span>;
  }
  const h = historyFor(id);
  return <span className="num">{h ? `Ep ${h.episode}${total ? ` of ${total}` : ''}` : total ? `${total} episodes` : 'Anime'}</span>;
}

function WatchRow({ h, onRemove }: { h: HistoryEntry; onRemove: () => void }) {
  const done = h.duration && h.position / h.duration > 0.9;
  return (
    <div className="history-row">
      <Link to={`/watch/${h.media.id}/${h.episode}`} className="history-link">
        <Img src={h.thumbnail || h.media.banner || h.media.cover} color={h.media.color} className="history-thumb" />
        <span className="history-text">
          <span className="history-title clamp-1">{h.media.title}</span>
          <span className="history-meta num">
            Episode {h.episode} · {done ? 'finished' : `${clock(h.position)} of ${clock(h.duration)}`} · {h.audio.toUpperCase()}
          </span>
        </span>
        <span className="history-when faint">{relativeTime(h.updatedAt)}</span>
      </Link>
      <IconButton icon="close" size={16} label={`Remove ${h.media.title} from history`} onClick={onRemove} />
    </div>
  );
}

function ReadRow({ r, onRemove }: { r: ReadingEntry; onRemove: () => void }) {
  return (
    <div className="history-row">
      <Link to={withQuery(`/read/${r.media.id}/${encodeURIComponent(r.chapterId)}`, { page: r.page > 1 ? r.page : null })} className="history-link">
        <Img src={r.media.cover} color={r.media.color} className="history-thumb is-cover" />
        <span className="history-text">
          <span className="history-title clamp-1">{r.media.title}</span>
          <span className="history-meta num">
            {r.chapterNumber ? `Chapter ${r.chapterNumber}` : 'Oneshot'} · page {r.page} of {r.pages}
          </span>
        </span>
        <span className="history-when faint">{relativeTime(r.updatedAt)}</span>
      </Link>
      <IconButton icon="close" size={16} label={`Remove ${r.media.title} from history`} onClick={onRemove} />
    </div>
  );
}
