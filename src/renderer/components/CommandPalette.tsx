import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Media } from '../../shared/types';
import { expandAlias } from '../lib/aliases';
import { coverOf, episodesLabel, formatLabel, isManga, mangaKind, mediaPath, mediaYear, titleOf } from '../lib/format';
import { navigate, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import { Icon, type IconName } from './Icon';
import { Img } from './Media';
import { Spinner } from './States';
import './palette.css';

interface Item {
  key: string;
  label: string;
  meta?: string;
  image?: string | null;
  color?: string | null;
  icon?: IconName;
  run: () => void;
}

interface Section {
  title: string;
  items: Item[];
}

const PAGES: { label: string; icon: IconName; to: string; keywords: string }[] = [
  { label: 'Anime home', icon: 'tv', to: '/', keywords: 'home anime watch' },
  { label: 'Manga home', icon: 'manga', to: '/manga', keywords: 'manga read comics manhwa' },
  { label: 'Discover', icon: 'discover', to: '/discover', keywords: 'browse filter genre' },
  { label: 'Schedule', icon: 'schedule', to: '/schedule', keywords: 'calendar airing week' },
  { label: 'Library', icon: 'library', to: '/library', keywords: 'list watching planning history' },
  { label: 'Downloads', icon: 'downloads', to: '/downloads', keywords: 'offline queue files' },
  { label: 'Settings', icon: 'settings', to: '/settings', keywords: 'preferences options folder accent' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, history, reading } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ anime: Media[]; manga: Media[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const expanded = expandAlias(query);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const q = expanded.query;
    if (!open || q.length < 2) {
      setResults(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const [anime, manga] = await Promise.all([
          window.playzanime.anilist.browse({ type: 'ANIME', search: q, perPage: 6 }),
          window.playzanime.anilist.browse({ type: 'MANGA', search: q, perPage: 4 }),
        ]);
        if (live) setResults({ anime: anime.items, manga: manga.items });
      } catch {
        if (live) setResults({ anime: [], manga: [] });
      } finally {
        if (live) setBusy(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [expanded.query, open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const mediaItem = (m: Media): Item => ({
    key: `m${m.id}`,
    label: titleOf(m, settings.titleLanguage),
    meta: [isManga(m) ? mangaKind(m) : formatLabel(m.format), mediaYear(m), episodesLabel(m)].filter(Boolean).join(' · '),
    image: coverOf(m),
    color: m.coverImage?.color,
    run: () => go(mediaPath(m)),
  });

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recent: Item[] = [
        ...history.slice(0, 3).map((h) => ({
          key: `h${h.media.id}`,
          label: h.media.title,
          meta: `Continue episode ${h.episode}`,
          image: h.media.cover,
          color: h.media.color,
          run: () => go(`/watch/${h.media.id}/${h.episode}`),
        })),
        ...reading.slice(0, 2).map((r) => ({
          key: `r${r.media.id}`,
          label: r.media.title,
          meta: `Continue chapter ${r.chapterNumber ?? ''}`.trim(),
          image: r.media.cover,
          color: r.media.color,
          run: () => go(`/read/${r.media.id}/${encodeURIComponent(r.chapterId)}`),
        })),
      ];
      return [
        ...(recent.length ? [{ title: 'Pick up where you left off', items: recent }] : []),
        { title: 'Go to', items: PAGES.map((p) => ({ key: p.to, label: p.label, icon: p.icon, run: () => go(p.to) })) },
      ];
    }
    const pages = PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.keywords.includes(q)).map((p) => ({
      key: p.to,
      label: p.label,
      icon: p.icon,
      run: () => go(p.to),
    }));
    const out: Section[] = [];
    if (results?.anime.length) out.push({ title: 'Anime', items: results.anime.map(mediaItem) });
    if (results?.manga.length) out.push({ title: 'Manga', items: results.manga.map(mediaItem) });
    if (pages.length) out.push({ title: 'Pages', items: pages });
    out.push({
      title: '',
      items: [
        {
          key: 'all',
          label: `See all results for “${expanded.query}”`,
          icon: 'search',
          run: () => go(withQuery('/discover', { q: expanded.query })),
        },
      ],
    });
    return out;
  }, [query, results, history, reading, settings.titleLanguage]);

  const flat = sections.flatMap((s) => s.items);

  useEffect(() => {
    setActive(0);
  }, [results, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey && query.trim()) go(withQuery('/discover', { q: expanded.query }));
      else flat[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let index = -1;
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anime and manga, or jump to a page"
            aria-label="Search"
            spellCheck={false}
          />
          {busy ? <Spinner size={16} /> : query && <kbd>Esc</kbd>}
        </div>
        {expanded.expanded && (
          <div className="palette-alias">
            Searching for <strong>{expanded.query}</strong>
          </div>
        )}
        <div className="palette-list" ref={listRef}>
          {sections.map((s, si) => (
            <div key={s.title || si} className="palette-section">
              {s.title && <div className="palette-heading">{s.title}</div>}
              {s.items.map((item) => {
                index++;
                const i = index;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-index={i}
                    className={`palette-item ${i === active ? 'is-active' : ''}`}
                    onMouseMove={() => setActive(i)}
                    onClick={item.run}
                  >
                    {item.image !== undefined ? (
                      <Img src={item.image} color={item.color} className="palette-thumb" />
                    ) : (
                      <span className="palette-icon">{item.icon && <Icon name={item.icon} size={17} />}</span>
                    )}
                    <span className="palette-text">
                      <span className="palette-label">{item.label}</span>
                      {item.meta && <span className="palette-meta">{item.meta}</span>}
                    </span>
                    {i === active && <Icon name="arrowRight" size={15} className="palette-enter" />}
                  </button>
                );
              })}
            </div>
          ))}
          {query.trim().length >= 2 && !busy && results && !results.anime.length && !results.manga.length && (
            <p className="palette-none">Nothing on AniList matches “{expanded.query}”. Check the spelling or try the romaji title.</p>
          )}
        </div>
        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Ctrl</kbd> <kbd>Enter</kbd> all results
          </span>
        </footer>
      </div>
    </div>
  );
}
