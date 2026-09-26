import { useMemo, useState } from 'react';
import type { ReadingEntry } from '../../shared/types';
import { Button, IconButton, Tabs } from '../components/Controls';
import { Hero, type HeroSlide } from '../components/Hero';
import { Icon } from '../components/Icon';
import { ListButton } from '../components/ListButton';
import { Img, PosterCard, PosterSkeletons, Shelf } from '../components/Media';
import { ErrorState } from '../components/States';
import { useLoader } from '../lib/data';
import { coverOf, mangaKind, mediaYear, plainText, relativeTime, scoreLabel, snapshot, titleOf } from '../lib/format';
import { Link, navigate, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import './home.css';

const api = () => window.playzanime;

const GENRES = ['Action', 'Romance', 'Fantasy', 'Comedy', 'Drama', 'Slice of Life', 'Psychological', 'Horror', 'Mystery', 'Sports', 'Supernatural', 'Sci-Fi'];

const readPath = (r: ReadingEntry) => withQuery(`/read/${r.media.id}/${encodeURIComponent(r.chapterId)}`, { page: r.page > 1 ? r.page : null });

export function MangaHome() {
  const { settings, reading } = useApp();
  const feed = useLoader('mangaHome', () => api().anilist.mangaHome());
  const lang = settings.titleLanguage;

  const slides = useMemo<HeroSlide[]>(() => {
    const out: HeroSlide[] = [];
    const last = reading[0];
    if (last) {
      out.push({
        key: `r-${last.media.id}`,
        kicker: (
          <>
            <Icon name="history" size={15} /> Continue reading · <strong>{last.chapterNumber ? `Chapter ${last.chapterNumber}` : 'Oneshot'}</strong>
          </>
        ),
        title: last.media.title,
        native: last.media.native,
        banner: last.media.banner,
        cover: last.media.cover,
        color: last.media.color,
        meta: [`Page ${last.page} of ${last.pages}`, relativeTime(last.updatedAt)],
        progress: last.pages ? last.page / last.pages : null,
        actions: (
          <>
            <Button variant="primary" size="lg" icon="manga" onClick={() => navigate(readPath(last))}>
              Resume ch. {last.chapterNumber ?? ''}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate(`/manga/${last.media.id}`)}>
              Chapters
            </Button>
          </>
        ),
      });
    }
    for (const m of (feed.data?.trending ?? []).slice(0, last ? 4 : 5)) {
      out.push({
        key: `t-${m.id}`,
        kicker: <>Trending {mangaKind(m)?.toLowerCase()}</>,
        title: titleOf(m, lang),
        native: m.title.native,
        banner: m.bannerImage,
        cover: coverOf(m),
        color: m.coverImage?.color,
        meta: [mangaKind(m), mediaYear(m) && String(mediaYear(m)), m.chapters ? `${m.chapters} chapters` : m.status === 'RELEASING' ? 'Ongoing' : null, scoreLabel(m.averageScore) && `Score ${scoreLabel(m.averageScore)}`],
        description: plainText(m.description),
        actions: (
          <>
            <Button variant="primary" size="lg" icon="manga" onClick={() => navigate(`/manga/${m.id}`)}>
              Start reading
            </Button>
            <ListButton media={snapshot(m, lang)} />
          </>
        ),
      });
    }
    return out;
  }, [reading, feed.data, lang]);

  if (feed.error && !feed.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t load the manga catalog" error={feed.error} onRetry={feed.reload} />
      </div>
    );
  }

  return (
    <div className="page is-flush home">
      <Hero slides={slides} showNative={settings.showNativeTitles} />

      {reading.length > 0 && <ContinueReading items={reading.slice(0, 12)} />}

      <Shelf title="Trending manga" subtitle="What readers on AniList are picking up this week">
        {feed.loading ? <PosterSkeletons /> : (feed.data?.trending ?? []).map((m) => <PosterCard key={m.id} media={m} />)}
      </Shelf>

      <Shelf
        title="Manhwa"
        subtitle="Korean webtoons, read top to bottom"
        action={
          <Button variant="quiet" size="sm" iconRight="arrowRight" onClick={() => navigate(withQuery('/discover', { type: 'MANGA', country: 'KR' }))}>
            More manhwa
          </Button>
        }
      >
        {feed.loading ? <PosterSkeletons /> : (feed.data?.manhwa ?? []).map((m) => <PosterCard key={m.id} media={m} />)}
      </Shelf>

      <MangaGenres />

      <Shelf title="Highest rated" subtitle="Manga with the best AniList scores">
        {feed.loading ? <PosterSkeletons /> : (feed.data?.top ?? []).map((m) => <PosterCard key={m.id} media={m} />)}
      </Shelf>
    </div>
  );
}

function ContinueReading({ items }: { items: ReadingEntry[] }) {
  const { removeReading, saveReading, toast } = useApp();
  return (
    <Shelf title="Continue reading" className="continue-shelf">
      {items.map((r) => (
        <div key={r.media.id} className="reading-card">
          <Link to={readPath(r)} className="poster">
            <div className="poster-frame">
              <Img src={r.media.cover} color={r.media.color} />
              <span className="poster-badge num">Ch. {r.chapterNumber ?? '—'}</span>
              <div className="progress poster-progress">
                <div className="progress-fill" style={{ width: `${r.pages ? (r.page / r.pages) * 100 : 0}%` }} />
              </div>
            </div>
            <div className="poster-title clamp-2">{r.media.title}</div>
            <div className="poster-meta num">
              Page {r.page} of {r.pages}
            </div>
          </Link>
          <IconButton
            icon="close"
            label="Remove from Continue reading"
            size={15}
            className="wide-remove"
            onClick={() => {
              void removeReading(r.media.id);
              toast(`Removed ${r.media.title}`, { action: { label: 'Undo', run: () => saveReading(r) } });
            }}
          />
        </div>
      ))}
    </Shelf>
  );
}

function MangaGenres() {
  const [genre, setGenre] = useState(GENRES[0]);
  const page = useLoader(`mgenre:${genre}`, () => api().anilist.browse({ type: 'MANGA', genres: [genre], sort: 'TRENDING_DESC', perPage: 18 }));
  return (
    <section className="genre-block">
      <header className="shelf-head">
        <div className="shelf-heading">
          <h2 className="section-title">By genre</h2>
        </div>
        <Button variant="quiet" size="sm" iconRight="arrowRight" onClick={() => navigate(withQuery('/discover', { type: 'MANGA', genre }))}>
          More {genre.toLowerCase()}
        </Button>
      </header>
      <Tabs label="Genre" value={genre} onChange={setGenre} options={GENRES.map((g) => ({ value: g, label: g }))} className="genre-tabs" />
      <div className="poster-grid genre-grid">
        {page.error ? (
          <ErrorState compact error={page.error} onRetry={page.reload} />
        ) : page.loading ? (
          <PosterSkeletons count={12} />
        ) : (
          page.data?.items.map((m) => <PosterCard key={m.id} media={m} />)
        )}
      </div>
    </section>
  );
}
