import { useMemo, useState } from 'react';
import type { AiringItem, HistoryEntry, Media } from '../../shared/types';
import { Button, IconButton, ProgressBar, Tabs } from '../components/Controls';
import { Hero, type HeroSlide } from '../components/Hero';
import { Icon } from '../components/Icon';
import { ListButton } from '../components/ListButton';
import { Img, PosterCard, PosterSkeletons, Shelf } from '../components/Media';
import { ErrorState } from '../components/States';
import { useLoader } from '../lib/data';
import {
  clock,
  coverOf,
  episodesLabel,
  formatLabel,
  mediaYear,
  plainText,
  posterOf,
  relativeTime,
  scoreLabel,
  seasonName,
  snapshot,
  titleOf,
} from '../lib/format';
import { Link, navigate, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import './home.css';

const api = () => window.playzanime;

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Mystery', 'Sports', 'Supernatural', 'Horror', 'Psychological', 'Mecha', 'Thriller'];

export function Home() {
  const { settings, history } = useApp();
  const feed = useLoader('home', () => api().anilist.home());
  const hour = Math.floor(Date.now() / 3_600_000);
  const aired = useLoader(`aired:${hour}`, () => {
    const now = Math.floor(Date.now() / 1000);
    return api().anilist.schedule(now - 36 * 3600, now);
  });

  const lang = settings.titleLanguage;

  const slides = useMemo<HeroSlide[]>(() => {
    const out: HeroSlide[] = [];
    const last = history[0];
    if (last) {
      const left = Math.max(0, last.duration - last.position);
      out.push({
        key: `continue-${last.media.id}`,
        kicker: (
          <>
            <Icon name="history" size={15} /> Continue watching · <strong>Episode {last.episode}</strong>
          </>
        ),
        title: last.media.title,
        native: last.media.native,
        banner: last.media.banner,
        cover: last.media.cover,
        color: last.media.color,
        meta: [last.episodeTitle && !/^episode\s*\d+$/i.test(last.episodeTitle) ? last.episodeTitle : null, `${clock(left)} left`, last.audio.toUpperCase()],
        progress: last.duration ? last.position / last.duration : null,
        actions: (
          <>
            <Button variant="primary" size="lg" icon="play" onClick={() => navigate(`/watch/${last.media.id}/${last.episode}`)}>
              Resume E{last.episode}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate(`/anime/${last.media.id}`)}>
              Episodes
            </Button>
          </>
        ),
      });
    }
    for (const m of (feed.data?.trending ?? []).filter((m) => m.bannerImage).slice(0, last ? 4 : 5)) {
      const rank = (feed.data?.trending ?? []).indexOf(m) + 1;
      out.push({
        key: `t-${m.id}`,
        kicker: <>No. {rank} trending this week</>,
        title: titleOf(m, lang),
        native: m.title.native,
        banner: m.bannerImage,
        cover: coverOf(m),
        color: m.coverImage?.color,
        meta: [formatLabel(m.format), mediaYear(m) && String(mediaYear(m)), episodesLabel(m), m.studios?.nodes[0]?.name, scoreLabel(m.averageScore) && `Score ${scoreLabel(m.averageScore)}`],
        description: plainText(m.description),
        actions: (
          <>
            <Button variant="primary" size="lg" icon="play" onClick={() => navigate(`/watch/${m.id}/1`)}>
              {m.format === 'MOVIE' ? 'Play movie' : 'Play E1'}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate(`/anime/${m.id}`)}>
              Details
            </Button>
            <ListButton media={snapshot(m, lang)} />
          </>
        ),
      });
    }
    return out;
  }, [history, feed.data, lang]);

  if (feed.error && !feed.data) {
    return (
      <div className="page">
        <ErrorState title="Couldn’t load the anime catalog" error={feed.error} onRetry={feed.reload} />
      </div>
    );
  }

  const trending = feed.data?.trending ?? [];
  const season = feed.data?.seasonLabel;

  return (
    <div className="page is-flush home">
      <Hero slides={slides} showNative={settings.showNativeTitles} />

      {history.length > 0 && <ContinueShelf items={history.slice(0, 12)} />}

      <AiredRecently items={aired.data} />

      <Shelf variant="ranked" title="Top 10 this week" subtitle="Ranked by AniList activity over the last few days">
        {feed.loading ? <PosterSkeletons count={6} /> : trending.slice(0, 10).map((m, i) => <Ranked key={m.id} media={m} rank={i + 1} />)}
      </Shelf>

      <Shelf
        title={season ? `${seasonName(season.season)} ${season.year}` : 'This season'}
        subtitle="The most popular shows airing this season"
        action={
          season && (
            <Button variant="quiet" size="sm" iconRight="arrowRight" onClick={() => navigate(withQuery('/discover', { season: season.season, year: season.year, sort: 'POPULARITY_DESC' }))}>
              All of it
            </Button>
          )
        }
      >
        {feed.loading ? <PosterSkeletons /> : (feed.data?.season ?? []).map((m) => <PosterCard key={m.id} media={m} />)}
      </Shelf>

      <GenreGrid />

      <Shelf title="All-time favourites" subtitle="Highest rated on AniList, with enough viewers to count">
        {feed.loading ? <PosterSkeletons /> : (feed.data?.top ?? []).map((m) => <PosterCard key={m.id} media={m} />)}
      </Shelf>
    </div>
  );
}

// ── Continue watching ───────────────────────────────────────────────────────

function ContinueShelf({ items }: { items: HistoryEntry[] }) {
  const { removeHistory, toast, saveHistory } = useApp();
  return (
    <Shelf variant="wide" title="Continue watching" className="continue-shelf">
      {items.map((h) => {
        const left = Math.max(0, h.duration - h.position);
        return (
          <div key={h.media.id} className="wide-card">
            <Link to={`/watch/${h.media.id}/${h.episode}`} className="wide-link">
              <div className="wide-frame">
                <Img src={h.thumbnail || h.media.banner || h.media.cover} color={h.media.color} />
                <span className="wide-play" aria-hidden="true">
                  <Icon name="play" size={20} />
                </span>
                <span className="wide-ep num">E{h.episode}</span>
                <ProgressBar value={h.duration ? h.position / h.duration : 0} className="wide-progress" />
              </div>
              <div className="wide-title clamp-1">{h.media.title}</div>
              <div className="wide-meta num">
                {left > 30 ? `${clock(left)} left` : 'Finished'} · {relativeTime(h.updatedAt)}
              </div>
            </Link>
            <IconButton
              icon="close"
              label="Remove from Continue watching"
              size={15}
              className="wide-remove"
              onClick={() => {
                void removeHistory(h.media.id);
                toast(`Removed ${h.media.title}`, { action: { label: 'Undo', run: () => saveHistory(h) } });
              }}
            />
          </div>
        );
      })}
    </Shelf>
  );
}

// ── Aired recently ──────────────────────────────────────────────────────────

function AiredRecently({ items }: { items?: AiringItem[] }) {
  const { settings } = useApp();
  const picks = useMemo(
    () =>
      (items ?? [])
        .filter((i) => (i.media.popularity ?? 0) > 12000)
        .sort((a, b) => b.airingAt - a.airingAt)
        .slice(0, 9),
    [items],
  );
  if (!picks.length) return null;
  return (
    <section className="aired">
      <header className="shelf-head">
        <div className="shelf-heading">
          <h2 className="section-title">Just aired</h2>
          <p className="shelf-sub">New episodes from the last day and a half</p>
        </div>
        <Button variant="quiet" size="sm" iconRight="arrowRight" onClick={() => navigate('/schedule')}>
          Schedule
        </Button>
      </header>
      <div className="aired-grid">
        {picks.map((i) => (
          <Link key={i.id} to={`/watch/${i.media.id}/${i.episode}`} className="aired-row">
            <Img src={i.media.coverImage?.medium ?? coverOf(i.media)} color={i.media.coverImage?.color} className="aired-thumb" />
            <span className="aired-text">
              <span className="aired-title clamp-1">{titleOf(i.media, settings.titleLanguage)}</span>
              <span className="aired-meta num">
                Episode {i.episode}
                {i.media.episodes ? ` of ${i.media.episodes}` : ''} · {relativeTime(i.airingAt * 1000)}
              </span>
            </span>
            <Icon name="play" size={16} className="aired-go" />
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Ranked ──────────────────────────────────────────────────────────────────

function Ranked({ media, rank }: { media: Media; rank: number }) {
  const { settings } = useApp();
  const title = titleOf(media, settings.titleLanguage);
  return (
    <Link to={`/anime/${media.id}`} className="ranked" title={title}>
      <span className="ranked-num" aria-hidden="true">
        {rank}
      </span>
      <span className="sr-only">Rank {rank}:</span>
      <div className="ranked-card">
        <div className="poster-frame">
          <Img src={posterOf(media, settings.dataSaver)} color={media.coverImage?.color} />
        </div>
        <div className="poster-title clamp-1">{title}</div>
      </div>
    </Link>
  );
}

// ── Genre grid ──────────────────────────────────────────────────────────────

function GenreGrid() {
  const [genre, setGenre] = useState(GENRES[0]);
  const page = useLoader(`genre:${genre}`, () => api().anilist.browse({ genres: [genre], sort: 'TRENDING_DESC', perPage: 18 }));

  return (
    <section className="genre-block">
      <header className="shelf-head">
        <div className="shelf-heading">
          <h2 className="section-title">Trending by genre</h2>
        </div>
        <Button variant="quiet" size="sm" iconRight="arrowRight" onClick={() => navigate(withQuery('/discover', { genre }))}>
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
