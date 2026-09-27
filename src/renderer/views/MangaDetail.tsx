import { useMemo, useState } from 'react';
import { MANGA_PROVIDERS, providerName, type Chapter, type ChapterList, type MangaProviderId, type MediaDetail, type MediaSnapshot } from '../../shared/types';
import { Button, IconButton, Menu, Tabs } from '../components/Controls';
import { DetailFacts, DetailHeader, DetailSkeleton, RecommendedGrid, RelatedGrid } from '../components/Detail';
import { ChapterDownloadDialog } from '../components/DownloadDialogs';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
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

interface SourceSwitcherProps {
  open: boolean;
  onClose: () => void;
  list: ChapterList;
  onSelect: (provider: MangaProviderId) => void;
}

function SourceSwitcherDialog({ open, onClose, list, onSelect }: SourceSwitcherProps) {
  const [query, setQuery] = useState('');
  const extensionsLoader = useLoader('all-extensions', () => api().manga.extensions?.() ?? Promise.resolve([]), 5 * 60_000);
  const extensions = extensionsLoader.data ?? [];

  const discovered = list.providers;
  const discoveredIds = new Set(discovered.map((d) => d.provider));
  const otherProviders = MANGA_PROVIDERS.filter((p) => !discoveredIds.has(p.id));
  const availableExtensions = extensions.filter((e) => e.enabled && !discoveredIds.has(e.id as MangaProviderId));

  const q = query.trim().toLowerCase();
  const filterItem = (name: string, note?: string) => {
    if (!q) return true;
    return name.toLowerCase().includes(q) || Boolean(note && note.toLowerCase().includes(q));
  };

  const currentProviderId = list.provider ?? discovered[0]?.provider;

  const handlePick = (p: MangaProviderId) => {
    onSelect(p);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Reading Sources & Extensions" width={680}>
      <div className="source-modal-container">
        <div className="source-modal-explainer">
          <div className="explainer-header">
            <Icon name="layers" size={16} />
            <strong>How Sources & Extensions Work</strong>
          </div>
          <p>
            PlayzAnime automatically connects to 55+ scanlation groups and aggregator sources.
            If a chapter is missing or has a delay, choose any alternative provider below to pull the latest translations.
          </p>
        </div>

        <div className="source-search-box">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Search 55+ sources (e.g. Asura, Reaper, Bato, Flame, MangaSee)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Section 1: Discovered Sources */}
        <div className="source-section-title">Discovered for this title</div>
        <div className="source-cards-grid">
          {discovered
            .filter((p) => filterItem(providerName(p.provider), p.title ?? undefined))
            .map((p) => {
              const isActive = currentProviderId === p.provider;
              return (
                <div
                  key={p.provider}
                  className={`source-card ${isActive ? 'is-active' : ''}`}
                  onClick={() => handlePick(p.provider)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handlePick(p.provider);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="source-card-header">
                    <span className="source-card-title">{providerName(p.provider)}</span>
                    {isActive ? (
                      <span className="source-card-badge active">Active</span>
                    ) : p.chapterCount > 0 ? (
                      <span className="source-card-badge found">{p.chapterCount} ch</span>
                    ) : (
                      <span className="source-card-badge none">0 ch</span>
                    )}
                  </div>
                  <div className="source-card-meta">
                    {p.latest ? `Latest: Chapter ${p.latest}` : p.error ? p.error : 'No chapters found'}
                  </div>
                  <div className="source-card-footer">
                    {isActive ? (
                      <span className="source-active-indicator">✓ Currently Selected</span>
                    ) : (
                      <span className="source-switch-action">Switch to this source →</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Section 2: Other Extensions (Scan on demand) */}
        {(otherProviders.length > 0 || availableExtensions.length > 0) && (
          <>
            <div className="source-section-title">
              Available Extensions (Click to Scan & Read)
            </div>
            <div className="source-cards-grid">
              {otherProviders
                .filter((p) => filterItem(p.name, p.note))
                .map((p) => (
                  <div
                    key={p.id}
                    className="source-card"
                    onClick={() => handlePick(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePick(p.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="source-card-header">
                      <span className="source-card-title">{p.name}</span>
                      <span className="source-card-badge engine">Built-in</span>
                    </div>
                    <div className="source-card-meta">{p.note}</div>
                    <div className="source-card-footer">
                      <span className="source-switch-action">Scan for chapters →</span>
                    </div>
                  </div>
                ))}

              {availableExtensions
                .filter((ext) => filterItem(ext.name, ext.note))
                .map((ext) => (
                  <div
                    key={ext.id}
                    className="source-card"
                    onClick={() => handlePick(ext.id as MangaProviderId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePick(ext.id as MangaProviderId);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="source-card-header">
                      <span className="source-card-title">{ext.name}</span>
                      <span className={`source-card-badge engine-${ext.engine}`}>{ext.category}</span>
                    </div>
                    <div className="source-card-meta">{ext.note}</div>
                    <div className="source-card-footer">
                      <span className="source-switch-action">Scan & Switch →</span>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}

        <div className="source-modal-footer">
          <span>Tachiyomi / Mihon Multi-Source Architecture</span>
          <button
            type="button"
            className="source-settings-link"
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
          >
            <Icon name="settings" size={13} />
            <span>Manage Extensions in Settings</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ChapterPanel({ media, snap, list, read, setRead, currentId, onProvider, onRefresh }: PanelProps) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState(false);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [limit, setLimit] = useState(120);

  const ordered = useMemo(() => (newestFirst ? [...list.chapters].reverse() : list.chapters), [list.chapters, newestFirst]);
  const q = filter.trim().toLowerCase();
  const shown = q ? ordered.filter((c) => c.number === q || (c.title ?? '').toLowerCase().includes(q)) : ordered;
  const unread = list.chapters.filter((c) => !c.number || !read.has(c.number));
  const withChapters = list.providers.filter((p) => p.chapterCount > 0);
  const activeProvider = list.provider ?? withChapters[0]?.provider;
  const activeSummary = list.providers.find((p) => p.provider === activeProvider);

  if (!list.chapters.length) {
    const down = list.providers.filter((p) => p.error);
    return (
      <>
        <EmptyState
          compact
          icon="manga"
          title="No chapters found on this source"
          body={
            down.length
              ? `${down.map((p) => providerName(p.provider)).join(' and ')} couldn’t be reached. You can switch to another source or scan any of the 55 extensions.`
              : `This source does not have chapters for this title. Try scanning alternative scanlations or aggregators below.`
          }
          action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button icon="refresh" onClick={onRefresh}>
                Check again
              </Button>
              <Button variant="ghost" icon="layers" onClick={() => setSourceDialog(true)}>
                Switch Source / Extensions (55)
              </Button>
            </div>
          }
        />
        <SourceSwitcherDialog
          open={sourceDialog}
          onClose={() => setSourceDialog(false)}
          list={list}
          onSelect={(p) => {
            onProvider(p);
            setSourceDialog(false);
          }}
        />
      </>
    );
  }

  // Saving chapters lives in the Windows app; every download button explains that.
  const download = (_c: Chapter) => setDialog(true);

  return (
    <div className="eps">
      <div className="eps-toolbar">
        <div className="source-picker-cluster">
          <button
            type="button"
            className="source-active-pill"
            onClick={() => setSourceDialog(true)}
            title="Click to switch reading source or test 55+ extensions"
          >
            <span className="source-live-dot" />
            <span className="source-pill-label">Source:</span>
            <span className="source-pill-name">{providerName(activeProvider)}</span>
            {activeSummary?.latest && <span className="source-pill-badge">ch. {activeSummary.latest}</span>}
            <Icon name="chevronDown" size={13} />
          </button>

          {withChapters
            .filter((p) => p.provider !== activeProvider)
            .slice(0, 2)
            .map((p) => (
              <button
                key={p.provider}
                type="button"
                className="source-alt-pill"
                onClick={() => onProvider(p.provider)}
                title={`Switch to ${providerName(p.provider)}`}
              >
                <span className="source-alt-name">{providerName(p.provider)}</span>
                <span className="source-alt-badge">{p.latest ? `ch. ${p.latest}` : `${p.chapterCount} ch`}</span>
              </button>
            ))}

          <button
            type="button"
            className="source-browse-all-btn"
            onClick={() => setSourceDialog(true)}
            title="Browse all 55 sources & extensions"
          >
            <Icon name="layers" size={13} />
            <span>Switch Source</span>
          </button>
        </div>
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
      <SourceSwitcherDialog
        open={sourceDialog}
        onClose={() => setSourceDialog(false)}
        list={list}
        onSelect={(p) => {
          onProvider(p);
          setSourceDialog(false);
        }}
      />
    </div>
  );
}
