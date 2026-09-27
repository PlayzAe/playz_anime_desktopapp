import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OFFLINE_MEDIA } from '../../shared/api';
import { providerName, type Chapter, type ChapterPage, type MangaProviderId, type MediaSnapshot, type OfflineItem, type ReaderDirection, type ReaderFit, type ReaderMode } from '../../shared/types';
import { Button, IconButton, Menu, Segmented } from '../components/Controls';
import { Icon } from '../components/Icon';
import { ErrorState, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { snapshot, titleOf } from '../lib/format';
import { goBack, navigate, useRoute } from '../lib/router';
import { useApp, useReadChapters } from '../lib/store';
import { readPath } from './MangaDetail';
import './reader.css';

const api = () => window.playzanime;

const chapterName = (c?: Chapter | null) => (c ? (c.number ? `Chapter ${c.number}` : 'Oneshot') : '');

/** A chapter read from a provider over the network. */
export function Reader({ id, chapterId }: { id: number; chapterId: string }) {
  const { settings, toast } = useApp();
  const provider = chapterId.split(':')[0] as MangaProviderId;
  const media = useLoader(`media:${id}`, () => api().anilist.media(id), 15 * 60_000);
  const list = useLoader(`chapters:${id}:${provider}`, () => api().manga.chapters(id, provider), 15 * 60_000);
  // The page list only needs the id, so it loads in parallel with the chapter list.
  const pages = useLoader(`pages:${chapterId}:${settings.dataSaver}`, () => api().manga.pages({ id: chapterId, provider } as Chapter), 4 * 60_000);
  const chapters = useMemo(() => (list.data?.chapters ?? []).filter((c) => !c.externalUrl), [list.data]);
  const number = chapters.find((c) => c.id === chapterId)?.number ?? null;

  // A source can go down or lose one chapter; the same chapter number elsewhere is just as good.
  const tryOtherSource = async () => {
    const others = (list.data?.providers ?? []).filter((p) => p.provider !== provider && p.chapterCount > 0);
    for (const p of others) {
      try {
        const alt = (await api().manga.chapters(id, p.provider)).chapters.find((c) => !c.externalUrl && c.number !== null && c.number === number);
        if (alt) {
          toast(`Reading chapter ${number} from ${providerName(p.provider)}`);
          navigate(readPath(id, alt), { replace: true });
          return;
        }
      } catch {
        /* try the next one */
      }
    }
    toast('No other source has this chapter right now.', { tone: 'error' });
  };

  return (
    <ReaderView
      mediaId={id}
      title={media.data ? titleOf(media.data, settings.titleLanguage) : ''}
      media={media.data ? snapshot(media.data, settings.titleLanguage) : null}
      webtoon={media.data?.countryOfOrigin === 'KR' || media.data?.countryOfOrigin === 'CN'}
      chapters={chapters}
      chapterId={chapterId}
      pages={pages}
      onChapter={(c) => navigate(readPath(id, c), { replace: true })}
      caughtUpNote={`This is the newest chapter on ${providerName(provider)}.`}
      onTryOtherSource={number ? () => void tryOtherSource() : undefined}
    />
  );
}

/** A downloaded chapter, read straight out of its CBZ with no network. */
export function OfflineReader({ jobId }: { jobId: string }) {
  const items = useLoader('offline:items', () => api().offline.items(), 10_000);
  const pages = useLoader(`offline:pages:${jobId}`, async () => {
    const count = await api().offline.pageCount(jobId);
    return Array.from({ length: count }, (_, i): ChapterPage => ({ url: `${OFFLINE_MEDIA}/${encodeURIComponent(jobId)}/${i}` }));
  }, Infinity);

  const item = items.data?.find((i) => i.jobId === jobId);
  // Every downloaded chapter of this series, oldest first, so next/previous stay offline.
  const siblings = useMemo(() => {
    if (!item || !items.data) return [];
    const byNumber = new Map<string, OfflineItem>();
    for (const i of items.data) if (i.kind === 'chapter' && i.media.id === item.media.id) byNumber.set(i.chapterNumber ?? i.jobId, i);
    return [...byNumber.values()].sort((a, b) => Number(a.chapterNumber ?? 0) - Number(b.chapterNumber ?? 0));
  }, [item, items.data]);
  const chapters = useMemo(() => siblings.map(offlineChapter), [siblings]);

  if (items.data && !item) {
    return (
      <div className="reader">
        <ErrorState title="That chapter isn’t downloaded any more" error={new Error('It may have been removed from Downloads.')} onRetry={() => navigate('/downloads')} />
      </div>
    );
  }

  return (
    <ReaderView
      mediaId={item?.media.id ?? 0}
      title={item?.media.title ?? ''}
      media={item?.media ?? null}
      webtoon={false}
      chapters={chapters}
      chapterId={item ? offlineChapter(item).id : ''}
      pages={pages}
      onChapter={(c) => navigate(`/offline/read/${encodeURIComponent(c.id.slice('offline:'.length))}`, { replace: true })}
      caughtUpNote="That’s the last chapter you’ve downloaded."
      offline
      progressId={item?.chapterId}
    />
  );
}

function offlineChapter(i: OfflineItem): Chapter {
  return { id: `offline:${i.jobId}`, provider: 'mangadex', number: i.chapterNumber ?? null, title: null, volume: null, group: null, pages: null, publishedAt: null, externalUrl: null };
}

interface ReaderViewProps {
  mediaId: number;
  title: string;
  media: MediaSnapshot | null;
  webtoon: boolean;
  chapters: Chapter[];
  chapterId: string;
  pages: { data?: ChapterPage[] | null; error?: Error | null; reload?: () => void };
  onChapter: (c: Chapter) => void;
  caughtUpNote: string;
  offline?: boolean;
  /** The chapter id to save progress under, when it differs from the one used for navigation. */
  progressId?: string | null;
  /** Offered when this source can't serve the pages. */
  onTryOtherSource?: () => void;
}

function ReaderView({ mediaId: id, title, media, webtoon, chapters, chapterId, pages, onChapter, caughtUpNote, offline, progressId, onTryOtherSource }: ReaderViewProps) {
  const route = useRoute();
  const { settings, updateSettings, saveReading } = useApp();
  const { setRead } = useReadChapters(id || null);

  const index = chapters.findIndex((c) => c.id === chapterId);
  const chapter = index >= 0 ? chapters[index] : null;
  const prev = index > 0 ? chapters[index - 1] : null;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null;

  // Manhwa and manhua are drawn as one long strip, so they open in scroll mode whatever
  // the global setting says. Switching modes here only affects this series, this time.
  const [modeOverride, setModeOverride] = useState<ReaderMode | null>(null);
  const mode: ReaderMode = modeOverride ?? (webtoon ? 'vertical' : settings.readerMode);
  const setMode = (m: ReaderMode) => (webtoon ? setModeOverride(m) : void updateSettings({ readerMode: m }));
  const direction: ReaderDirection = settings.readerDirection;
  const fit: ReaderFit = settings.readerFit;

  const total = pages.data?.length ?? 0;
  const [page, setPage] = useState(() => Math.max(1, Number(route.query.get('page')) || 1));
  const [chrome, setChrome] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restored = useRef(false);
  const markedRead = useRef(false);
  const openedAt = useRef(Date.now());

  const goChapter = useCallback((c: Chapter | null) => c && onChapter(c), [onChapter]);
  const seriesPath = offline ? '/downloads' : `/manga/${id}`;
  const leave = useCallback(() => (history.state?.idx > 0 ? goBack() : navigate(seriesPath)), [seriesPath]);

  // Vertical mode: jump to the resume page once, then track the most visible page.
  useEffect(() => {
    if (mode !== 'vertical' || !total) return;
    if (!restored.current && page > 1) {
      restored.current = true;
      pageRefs.current[page - 1]?.scrollIntoView({ block: 'start' });
    }
    restored.current = true;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setPage(Number((visible.target as HTMLElement).dataset.page));
      },
      { root: scroller.current, threshold: [0.25, 0.5, 0.75] },
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [mode, total]);

  // Save progress and mark the chapter read on its last page. Offline reading counts too.
  useEffect(() => {
    if (!media || !total) return;
    const t = window.setTimeout(() => {
      saveReading({
        media,
        // Offline chapters record the source chapter, so "Continue reading" works once back online.
        chapterId: progressId ?? chapterId,
        chapterNumber: chapter?.number ?? null,
        chapterTitle: chapter?.title ?? null,
        page: Math.min(page, total),
        pages: total,
        updatedAt: Date.now(),
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [page, total, media, chapter?.id]);

  // A chapter counts as read once its last page has been on screen, and never within the
  // first few seconds: short chapters fit on one screen, and opening one isn't reading it.
  useEffect(() => {
    const number = chapter?.number;
    if (!total || page < total || !number || markedRead.current) return;
    const t = window.setTimeout(() => {
      markedRead.current = true;
      void setRead([number], true);
    }, Math.max(0, 5000 - (Date.now() - openedAt.current)));
    return () => window.clearTimeout(t);
  }, [page, total, chapter?.number]);

  // Paged mode: keep the next pages warm (fewer when saving data).
  useEffect(() => {
    if (mode !== 'paged' || !pages.data) return;
    for (const p of pages.data.slice(page, page + (settings.dataSaver && !offline ? 1 : 3))) new Image().src = p.url;
  }, [page, mode, pages.data, settings.dataSaver, offline]);

  const turn = useCallback(
    (delta: 1 | -1) => {
      if (mode === 'vertical') {
        scroller.current?.scrollBy({ top: delta * (scroller.current.clientHeight - 80), behavior: 'smooth' });
        return;
      }
      const target = page + delta;
      if (target < 1) goChapter(prev);
      else if (target > total + 1) goChapter(next);
      else setPage(target);
    },
    [mode, page, total, prev, next, goChapter],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input, [role="menu"]')) return;
      const k = e.key;
      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (mode === 'paged' && (k === forward || k === ' ' || k === 'PageDown')) turn(1);
      else if (mode === 'paged' && (k === backward || k === 'PageUp')) turn(-1);
      else if (k === ']') goChapter(next);
      else if (k === '[') goChapter(prev);
      else if (k === 'Escape') leave();
      else if (k.toLowerCase() === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      else if (k.toLowerCase() === 'm') setMode(mode === 'vertical' ? 'paged' : 'vertical');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, direction, turn, goChapter, next, prev, leave, updateSettings, webtoon]);

  // Hide the bars while reading; bring them back on mouse movement near the edges or a tap.
  const lastY = useRef(0);
  const onScroll = () => {
    const y = scroller.current?.scrollTop ?? 0;
    if (Math.abs(y - lastY.current) > 30) {
      setChrome(y < lastY.current || y < 40);
      lastY.current = y;
    }
  };

  const pct = total ? Math.min(1, page / total) : 0;
  const backLabel = offline ? 'Back to Downloads' : `Back to ${title || 'the manga'}`;

  const endCard = (
    <div className="reader-end">
      <span className="faint">End of {chapterName(chapter).toLowerCase()}</span>
      {next ? (
        <>
          <h2>{chapterName(next)}</h2>
          {next.title && <p className="muted">{next.title}</p>}
          <div className="reader-end-actions">
            <Button variant="primary" size="lg" iconRight="arrowRight" onClick={() => goChapter(next)}>
              Next chapter
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate(seriesPath)}>
              {offline ? 'Downloads' : 'All chapters'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2>You’re caught up</h2>
          <p className="muted">{caughtUpNote}</p>
          <div className="reader-end-actions">
            <Button variant="ghost" size="lg" onClick={() => navigate(seriesPath)}>
              {backLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  let body;
  if (pages.error && !pages.data) {
    body = (
      <div className="reader-failed">
        <ErrorState title="Couldn’t load this chapter" error={pages.error} onRetry={pages.reload} />
        {onTryOtherSource && (
          <Button variant="ghost" icon="refresh" onClick={onTryOtherSource}>
            Read this chapter from another source
          </Button>
        )}
      </div>
    );
  } else if (!pages.data) {
    body = (
      <div className="reader-loading">
        <Spinner size={30} label="Loading pages" />
      </div>
    );
  } else if (!total) {
    body = <ErrorState title="This chapter has no pages" error={new Error(offline ? 'The file has no pictures in it.' : 'The source returned an empty chapter. Try the other source from the chapter list.')} />;
  } else if (mode === 'vertical') {
    body = (
      <div className={`reader-strip fit-${fit} ${webtoon ? 'is-webtoon' : ''}`}>
        {pages.data.map((p, i) => (
          <div key={p.url} className="reader-page" data-page={i + 1} ref={(el) => void (pageRefs.current[i] = el)} style={aspect(p)}>
            <img src={p.url} alt={`Page ${i + 1}`} loading={i < 3 || Math.abs(i + 1 - page) < 3 ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" draggable={false} />
          </div>
        ))}
        {endCard}
      </div>
    );
  } else {
    const current: ChapterPage | undefined = pages.data[page - 1];
    body = (
      <div className={`reader-paged fit-${fit} dir-${direction}`}>
        {current ? <img key={current.url} src={current.url} alt={`Page ${page}`} referrerPolicy="no-referrer" draggable={false} /> : endCard}
        <button type="button" className="reader-zone is-left" aria-label={direction === 'rtl' ? 'Next page' : 'Previous page'} onClick={() => turn(direction === 'rtl' ? 1 : -1)} />
        <button type="button" className="reader-zone is-right" aria-label={direction === 'rtl' ? 'Previous page' : 'Next page'} onClick={() => turn(direction === 'rtl' ? -1 : 1)} />
      </div>
    );
  }

  return (
    <div
      className={`reader ${chrome ? '' : 'is-hidden'}`}
      onMouseMove={(e) => (e.clientY < 90 || e.clientY > window.innerHeight - 70) && setChrome(true)}
    >
      <header className="reader-top">
        <IconButton icon="arrowLeft" label="Back (Esc)" onClick={leave} />
        <div className="reader-titles">
          <button type="button" className="reader-series" onClick={() => navigate(offline ? '/downloads' : `/manga/${id}`)}>
            {offline && <Icon name="downloads" size={14} />}
            {title}
          </button>
          <Menu
            width={280}
            heading={offline ? 'Downloaded chapters' : 'Chapters'}
            items={chapters
              .slice()
              .reverse()
              .map((c) => ({ key: c.id, label: `${chapterName(c)}${c.title ? ` · ${c.title}` : ''}`, checked: c.id === chapterId, onSelect: () => goChapter(c) }))}
            trigger={({ toggle, open, id: menuId }) => (
              <button type="button" className="reader-chapter" aria-expanded={open} aria-controls={menuId} onClick={toggle}>
                {chapterName(chapter) || 'Chapter'}
                {chapter?.title && <span className="faint"> · {chapter.title}</span>}
                <Icon name="chevronDown" size={14} />
              </button>
            )}
          />
        </div>
        <div className="reader-drag" />
        <div className="reader-tools">
          <Segmented
            label="Reading mode"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'vertical', label: 'Scroll', title: 'Pages in one long strip (M)' },
              { value: 'paged', label: 'Pages', title: 'One page at a time (M)' },
            ]}
          />
          {mode === 'paged' && (
            <Segmented
              label="Direction"
              size="sm"
              value={direction}
              onChange={(v) => void updateSettings({ readerDirection: v })}
              options={[
                { value: 'rtl', label: 'Right to left', title: 'Japanese order' },
                { value: 'ltr', label: 'Left to right' },
              ]}
            />
          )}
          <Segmented
            label="Fit"
            size="sm"
            value={fit}
            onChange={(v) => void updateSettings({ readerFit: v })}
            options={[
              { value: 'width', label: 'Fit width' },
              { value: 'height', label: 'Fit height' },
            ]}
          />
          <IconButton icon="prev" label="Previous chapter ([)" disabled={!prev} onClick={() => goChapter(prev)} />
          <IconButton icon="next" label="Next chapter (])" disabled={!next} onClick={() => goChapter(next)} />
        </div>
      </header>

      <div className="reader-scroll" ref={scroller} onScroll={onScroll} onClick={() => mode === 'vertical' && setChrome((c) => !c)}>
        {body}
      </div>

      <footer className="reader-bottom">
        <div className="reader-progress" style={{ transform: `scaleX(${pct})` }} />
        {total > 0 && (
          <span className="reader-count num">
            {Math.min(page, total)} / {total}
          </span>
        )}
      </footer>
    </div>
  );
}

/** Known page sizes (MangaPill) reserve space before the image arrives, so nothing jumps. */
function aspect(p: ChapterPage) {
  return p.width && p.height ? { aspectRatio: `${p.width} / ${p.height}` } : undefined;
}
