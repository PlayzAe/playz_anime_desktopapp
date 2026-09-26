import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowseFilters, Media, MediaFormat, MediaSeason, MediaStatus, MediaType, SortKey } from '../../shared/types';
import { Button, Segmented, Select } from '../components/Controls';
import { Icon } from '../components/Icon';
import { PosterCard, PosterSkeletons } from '../components/Media';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { expandAlias } from '../lib/aliases';
import { currentSeasonLabel } from '../lib/season';
import { navigate, useRoute, withQuery } from '../lib/router';
import './discover.css';

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'TRENDING_DESC', label: 'Trending' },
  { value: 'POPULARITY_DESC', label: 'Most popular' },
  { value: 'SCORE_DESC', label: 'Highest rated' },
  { value: 'START_DATE_DESC', label: 'Newest' },
];

const ANIME_FORMATS: { value: string; label: string }[] = [
  { value: '', label: 'Any format' },
  { value: 'TV', label: 'TV series' },
  { value: 'MOVIE', label: 'Movies' },
  { value: 'ONA', label: 'ONA' },
  { value: 'OVA', label: 'OVA' },
  { value: 'SPECIAL', label: 'Specials' },
  { value: 'TV_SHORT', label: 'TV shorts' },
];

const MANGA_FORMATS = [
  { value: '', label: 'Any format' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'ONE_SHOT', label: 'One-shots' },
];

const COUNTRIES = [
  { value: '', label: 'Any origin' },
  { value: 'JP', label: 'Japan (manga)' },
  { value: 'KR', label: 'Korea (manhwa)' },
  { value: 'CN', label: 'China (manhua)' },
];

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'RELEASING', label: 'Airing / ongoing' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'NOT_YET_RELEASED', label: 'Not yet released' },
];

const SEASONS = [
  { value: '', label: 'Any season' },
  { value: 'WINTER', label: 'Winter' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
  { value: 'FALL', label: 'Fall' },
];

const thisYear = new Date().getFullYear();
const YEARS = [{ value: '', label: 'Any year' }, ...Array.from({ length: thisYear - 1969 }, (_, i) => ({ value: String(thisYear + 1 - i), label: String(thisYear + 1 - i) }))];

export function Discover() {
  const route = useRoute();
  const q = route.query;
  const type = (q.get('type') === 'MANGA' ? 'MANGA' : 'ANIME') as MediaType;
  const search = q.get('q') ?? '';
  const genres = useMemo(() => q.getAll('genre'), [q]);
  const filters: BrowseFilters = {
    type,
    search: search ? expandAlias(search).query : null,
    sort: (q.get('sort') as SortKey) || (search ? 'SEARCH_MATCH' : 'TRENDING_DESC'),
    genres,
    formats: q.get('format') ? [q.get('format') as MediaFormat] : undefined,
    season: (q.get('season') as MediaSeason) || null,
    year: Number(q.get('year')) || null,
    status: (q.get('status') as MediaStatus) || null,
    country: q.get('country') || null,
    perPage: 30,
  };
  const key = JSON.stringify(filters);

  const update = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(q);
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v) next.set(k, v);
    }
    const s = next.toString();
    navigate(`/discover${s ? `?${s}` : ''}`, { replace: true });
  };

  // Search box: typed text updates the URL after a pause.
  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  useEffect(() => {
    if (text === search) return;
    const t = setTimeout(() => update({ q: text.trim() || null, sort: null }), 380);
    return () => clearTimeout(t);
  }, [text]);

  // Paged results with infinite scroll.
  const [items, setItems] = useState<Media[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setItems([]);
    setPage(1);
    setLoading(true);
    setError(null);
    window.playzanime.anilist
      .browse({ ...filters, page: 1 })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setHasNext(r.hasNextPage);
      })
      .catch((e: Error) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const loadMore = () => {
    if (loading || !hasNext) return;
    setLoading(true);
    window.playzanime.anilist
      .browse({ ...filters, page: page + 1 })
      .then((r) => {
        setItems((prev) => [...prev, ...r.items.filter((m) => !prev.some((p) => p.id === m.id))]);
        setHasNext(r.hasNextPage);
        setPage(page + 1);
      })
      .catch((e: Error) => setError(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const active = Boolean(search || genres.length || q.get('format') || q.get('season') || q.get('year') || q.get('status') || q.get('country') || q.get('sort'));
  const alias = search ? expandAlias(search) : null;
  const season = currentSeasonLabel();

  return (
    <div className="page discover">
      <div className="page-head discover-head">
        <div>
          <h1 className="page-title display">Discover</h1>
          <p className="page-sub">Everything on AniList, filtered your way.</p>
        </div>
        <Segmented
          label="Type"
          value={type}
          onChange={(v) => update({ type: v === 'MANGA' ? 'MANGA' : null, format: null, season: null, country: null, genre: null })}
          options={[
            { value: 'ANIME', label: 'Anime' },
            { value: 'MANGA', label: 'Manga' },
          ]}
        />
      </div>

      <div className="discover-filters">
        <label className="discover-search">
          <Icon name="search" size={17} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={type === 'MANGA' ? 'Search manga, manhwa…' : 'Search anime, or try jjk, aot, csm'} aria-label="Search" />
          {text && (
            <button type="button" aria-label="Clear search" onClick={() => setText('')}>
              <Icon name="close" size={15} />
            </button>
          )}
        </label>
        <Select label="Sort" value={filters.sort === 'SEARCH_MATCH' ? '' : (filters.sort ?? '')} width={150} onChange={(v) => update({ sort: v || null })} options={search ? [{ value: '', label: 'Best match' }, ...SORTS] : SORTS} />
        <Select label="Format" value={q.get('format') ?? ''} width={150} onChange={(v) => update({ format: v || null })} options={type === 'MANGA' ? MANGA_FORMATS : ANIME_FORMATS} />
        {type === 'ANIME' ? (
          <>
            <Select label="Season" value={q.get('season') ?? ''} width={140} onChange={(v) => update({ season: v || null, year: v && !q.get('year') ? String(season.year) : q.get('year') })} options={SEASONS} />
            <Select label="Year" value={q.get('year') ?? ''} width={120} onChange={(v) => update({ year: v || null })} options={YEARS} />
          </>
        ) : (
          <Select label="Origin" value={q.get('country') ?? ''} width={170} onChange={(v) => update({ country: v || null })} options={COUNTRIES} />
        )}
        <Select label="Status" value={q.get('status') ?? ''} width={170} onChange={(v) => update({ status: v || null })} options={STATUSES} />
        {active && (
          <Button variant="quiet" size="sm" icon="close" onClick={() => navigate(withQuery('/discover', { type: type === 'MANGA' ? 'MANGA' : null }), { replace: true })}>
            Clear
          </Button>
        )}
      </div>

      <div className="genre-chips" role="group" aria-label="Genres">
        {GENRES.map((g) => {
          const on = genres.includes(g);
          return (
            <button key={g} type="button" className={`chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => update({ genre: on ? genres.filter((x) => x !== g) : [...genres, g] })}>
              {on && <Icon name="check" size={13} />}
              {g}
            </button>
          );
        })}
      </div>

      {alias?.expanded && (
        <p className="discover-alias">
          Showing results for <strong>{alias.query}</strong>
        </p>
      )}

      <div className="discover-results">
        {error && !items.length ? (
          <ErrorState error={error} onRetry={() => setAttempt((a) => a + 1)} />
        ) : !loading && !items.length ? (
          <EmptyState
            icon="search"
            title="Nothing matches"
            body={search ? `No ${type === 'MANGA' ? 'manga' : 'anime'} titled “${search}” with these filters. Check the spelling or try the Japanese title.` : 'Remove a genre or widen the year to see more.'}
            action={active ? <Button onClick={() => navigate('/discover', { replace: true })}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className="poster-grid">
            {items.map((m) => (
              <PosterCard key={m.id} media={m} />
            ))}
            {loading && <PosterSkeletons count={items.length ? 6 : 18} />}
          </div>
        )}
        <div ref={sentinel} className="discover-sentinel">
          {loading && items.length > 0 && <Spinner size={18} />}
          {!hasNext && items.length > 30 && <span className="faint">That’s everything.</span>}
        </div>
      </div>
    </div>
  );
}
