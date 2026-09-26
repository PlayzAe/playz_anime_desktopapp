import { useMemo, useState } from 'react';
import { MANGA_PROVIDERS, providerName, type Chapter, type ChapterList, type MangaProviderId, type MediaDetail, type MediaSnapshot } from '../../shared/types';
import { Button, IconButton, Menu, Segmented, Tabs } from '../components/Controls';
import { DetailFacts, DetailHeader, DetailSkeleton, RecommendedGrid, RelatedGrid } from '../components/Detail';
import { ChapterDownloadDialog } from '../components/DownloadDialogs';
import { Icon } from '../components/Icon';
import { ListButton } from '../components/ListButton';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { relativeTime, snapshot } from '../lib/format';
import { navigate, withQuery } from '../lib/router';
import { useApp, useReadChapters } from '../lib/store';
import './series.css';

const api = () => window.playzanime;


export const readPath = (mediaId: number, chapter: Chapter, page?: number) =>
  withQuery(`/read/${mediaId}/${encodeURIComponent(chapter.id)}`, { page: page && page > 1 ? page : null });

export function MangaDetail({ id }: { id: number }) {
  const { settings, readingFor } = useApp();
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const [provider, setProvider] = useState<MangaProviderId | null>(null);
  const chapters = useLoader(`chapters:${id}:${provider ?? 'auto'}`, () => api().manga.chapters(id, provider), 15 * 60_000);
  const { read, setRead } = useReadChapters(id);
  const [tab, setTab] = useState<'chapters' | 'related' | 'similar'>('chapters');

  if (media.error && !media.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t load this manga" error={media.error} onRetry={media.reload} />
      </div>
    );
  }
  if (!media.data) return <DetailSkeleton />;

  const m = media.data;
  const snap = snapshot(m, settings.titleLanguage);
  const list = chapters.data;
  const readable = (list?.chapters ?? []).filter((c) => !c.externalUrl);
  const progress = readingFor(id);
  const resume = progress && readable.find((c) => c.id === progress.chapterId);
  const firstUnread = readable.find((c) => !c.number || !read.has(c.number));

  const primary = resume ? (
    <Button variant="primary" size="lg" icon="manga" onClick={() => navigate(readPath(id, resume, progress.page))}>
      Resume ch. {resume.number} · p. {progress.page}
    </Button>
  ) : firstUnread ? (
    <Button variant="primary" size="lg" icon="manga" onClick={() => navigate(readPath(id, firstUnread))}>
      {read.size ? `Read ch. ${firstUnread.number}` : 'Start reading'}
    </Button>
  ) : null;

  return (
    <div className="page is-flush">
      <DetailHeader
        media={m}
        actions={
          <>
            {primary}
            <ListButton media={snap} />
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
              { value: 'chapters', label: 'Chapters', count: list?.chapters.length || undefined },
              { value: 'related', label: 'Related', count: m.relations?.edges.length || undefined },
              { value: 'similar', label: 'More like this' },
            ]}
          />
          {tab === 'chapters' &&
            (chapters.error && !list ? (
              <ErrorState compact title="Couldn’t load chapters" error={chapters.error} onRetry={chapters.reload} />
            ) : !list ? (
              <div className="eps-loading">
                <Spinner label={`Checking ${MANGA_PROVIDERS.map((p) => p.name).join(', ')}`} />
              </div>
            ) : (
              <ChapterPanel
                media={m}
                snap={snap}
                list={list}
                read={read}
                setRead={setRead}
                currentId={progress?.chapterId ?? null}
                onProvider={(p) => setProvider(p)}
                onRefresh={() => void api().manga.chapters(id, provider, true).then(chapters.reload)}
              />
            ))}
          {tab === 'related' && <RelatedGrid media={m} />}
          {tab === 'similar' && <RecommendedGrid media={m} />}
        </div>
        <DetailFacts media={m} />
      </div>
    </div>
  );
}

// ── Chapters ────────────────────────────────────────────────────────────────

interface PanelProps {
  media: MediaDetail;
  snap: MediaSnapshot;
  list: ChapterList;
  read: Set<string>;
  setRead: (chapters: string[], value: boolean) => Promise<void>;
  currentId: string | null;
  onProvider: (p: MangaProviderId) => void;
  onRefresh: () => void;
}

function ChapterPanel({ media, snap, list, read, setRead, currentId, onProvider, onRefresh }: PanelProps) {
  const { toast } = useApp();
  const [newestFirst, setNewestFirst] = useState(true);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState(false);
  const [limit, setLimit] = useState(120);

  const ordered = useMemo(() => (newestFirst ? [...list.chapters].reverse() : list.chapters), [list.chapters, newestFirst]);
  const q = filter.trim().toLowerCase();
  const shown = q ? ordered.filter((c) => c.number === q || (c.title ?? '').toLowerCase().includes(q)) : ordered;
  const unread = list.chapters.filter((c) => !c.number || !read.has(c.number));
  const withChapters = list.providers.filter((p) => p.chapterCount > 0);

  if (!list.chapters.length) {
    const down = list.providers.filter((p) => p.error);
    return (
      <EmptyState
        compact
        icon="manga"
        title="No chapters found"
        body={
          down.length
            ? `${down.map((p) => providerName(p.provider)).join(' and ')} couldn’t be reached, and the other sources don’t have this title in English. Try again in a few minutes.`
            : `None of ${MANGA_PROVIDERS.map((p) => p.name).join(', ')} has this title in English. Licensed series are often only on the publisher’s own app.`
        }
        action={
          <Button icon="refresh" onClick={onRefresh}>
            Check again
          </Button>
        }
      />
    );
  }

  const download = (c: Chapter) => {
    void window.playzanime.downloads.start({ kind: 'chapter', media: snap, chapter: c }).then(() =>
      toast(`Downloading chapter ${c.number ?? ''}`, { action: { label: 'View', run: () => navigate('/downloads') } }),
    );
  };

  return (
    <div className="eps">
      <div className="eps-toolbar">
        {withChapters.length > 1 && (
          <Segmented
            label="Source"
            size="sm"
            value={list.provider ?? withChapters[0].provider}
            onChange={onProvider}
            options={withChapters.map((p) => ({
              value: p.provider,
              label: `${providerName(p.provider)} · ${p.latest ? `ch. ${p.latest}` : p.chapterCount}`,
              title: `${p.title ?? ''} · ${p.chapterCount} chapters`,
            }))}
          />
        )}
        {withChapters.length === 1 && <span className="source-note faint">From {providerName(withChapters[0].provider)}</span>}
        {list.chapters.length > 20 && (
          <label className="eps-filter">
            <Icon name="search" size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a chapter" aria-label="Find a chapter" />
          </label>
        )}
        <div className="eps-spacer" />
        <Button variant="quiet" size="sm" icon="sort" onClick={() => setNewestFirst(!newestFirst)}>
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </Button>
        <Button variant="ghost" size="sm" icon="downloads" onClick={() => setDialog(true)}>
          Download
        </Button>
        <Menu
          width={230}
          items={[
            { key: 'all', label: 'Mark all as read', icon: 'check', onSelect: () => void setRead(list.chapters.flatMap((c) => (c.number ? [c.number] : [])), true) },
            { key: 'none', label: 'Mark all as unread', icon: 'close', onSelect: () => void setRead(list.chapters.flatMap((c) => (c.number ? [c.number] : [])), false) },
            'divider',
            { key: 'refresh', label: 'Look for new chapters', icon: 'refresh', onSelect: onRefresh },
          ]}
          trigger={({ toggle, open, id }) => <IconButton icon="more" label="More chapter actions" aria-expanded={open} aria-controls={id} onClick={toggle} />}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState compact icon="search" title={`No chapter matches “${filter}”`} body="Search by number or by a word from the title." />
      ) : (
        <div className="eps-list chapters">
          {shown.slice(0, q ? undefined : limit).map((c) => {
            const isRead = Boolean(c.number && read.has(c.number));
            return (
              <div key={c.id} className={`ep ${isRead ? 'is-watched' : ''} ${c.id === currentId ? 'is-next' : ''}`}>
                <button
                  type="button"
                  className="ep-open"
                  onClick={() => (c.externalUrl ? void window.playzanime.app.openExternal(c.externalUrl) : navigate(readPath(media.id, c)))}
                >
                  <div className="ep-text">
                    <span className="ep-num num">
                      {c.number ? `Chapter ${c.number}` : 'Oneshot'}
                      {c.volume && <span className="faint">Vol. {c.volume}</span>}
                      {c.id === currentId && <span className="ep-next">Reading</span>}
                      {c.externalUrl && (
                        <span className="ep-flag">
                          Official site <Icon name="external" size={11} />
                        </span>
                      )}
                    </span>
                    <span className="ep-title clamp-1">{c.title ?? ''}</span>
                  </div>
                  <span className="chapter-meta faint">
                    {[c.group, c.publishedAt ? relativeTime(c.publishedAt) : null].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <div className="ep-actions">
                  {c.number && (
                    <IconButton icon="check" size={16} label={isRead ? 'Mark as unread' : 'Mark as read'} active={isRead} onClick={() => void setRead([c.number!], !isRead)} />
                  )}
                  {!c.externalUrl && <IconButton icon="downloads" size={16} label={`Download chapter ${c.number ?? ''}`} onClick={() => download(c)} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!q && shown.length > limit && (
        <div className="more-row">
          <Button variant="ghost" onClick={() => setLimit(limit + 200)}>
            Show more chapters ({shown.length - limit} left)
          </Button>
        </div>
      )}

      <ChapterDownloadDialog open={dialog} onClose={() => setDialog(false)} media={snap} chapters={list.chapters} unread={unread} />
    </div>
  );
}
