import { useMemo } from 'react';
import type { AiringItem } from '../../shared/types';
import { Button, IconButton, Segmented } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Img } from '../components/Media';
import { ErrorState, Spinner } from '../components/States';
import { useLoader } from '../lib/data';
import { coverOf, titleOf } from '../lib/format';
import { Link, navigate, useRoute, withQuery } from '../lib/router';
import { useApp } from '../lib/store';
import './schedule.css';

const DAY = 86_400_000;

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

export function Schedule() {
  const route = useRoute();
  const { settings, library } = useApp();
  const offset = Number(route.query.get('week')) || 0;
  const scope = route.query.get('scope') === 'mine' ? 'mine' : 'all';
  const start = useMemo(() => {
    const m = mondayOf(new Date());
    m.setDate(m.getDate() + offset * 7);
    return m;
  }, [offset]);
  const from = Math.floor(start.getTime() / 1000);
  const to = from + 7 * 86400;
  const data = useLoader(`schedule:${from}`, () => window.playzanime.anilist.schedule(from, to), 10 * 60_000);

  const mine = useMemo(() => new Set(library.map((e) => e.media.id)), [library]);
  const days = useMemo(() => {
    const buckets: AiringItem[][] = Array.from({ length: 7 }, () => []);
    for (const item of data.data ?? []) {
      if (scope === 'mine' && !mine.has(item.media.id)) continue;
      const i = Math.floor((item.airingAt * 1000 - start.getTime()) / DAY);
      if (i >= 0 && i < 7) buckets[i].push(item);
    }
    return buckets;
  }, [data.data, scope, mine, start]);

  const go = (patch: { week?: number; scope?: string }) =>
    navigate(withQuery('/schedule', { week: (patch.week ?? offset) || null, scope: (patch.scope ?? scope) === 'mine' ? 'mine' : null }), { replace: true });

  const end = new Date(start.getTime() + 6 * DAY);
  const range = `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const now = Date.now();
  const total = days.reduce((n, d) => n + d.length, 0);

  return (
    <div className="page schedule">
      <div className="page-head schedule-head">
        <div>
          <h1 className="page-title display">Schedule</h1>
          <p className="page-sub num">
            {range} · times in your time zone{data.data ? ` · ${total} episodes` : ''}
          </p>
        </div>
        <div className="schedule-controls">
          <Segmented
            label="Show"
            value={scope}
            onChange={(v) => go({ scope: v })}
            options={[
              { value: 'all', label: 'Everything airing' },
              { value: 'mine', label: `My library (${library.filter((e) => e.media.type !== 'MANGA').length})`, disabled: library.length === 0, title: library.length ? undefined : 'Add shows to your library first' },
            ]}
          />
          <div className="schedule-nav">
            <IconButton icon="chevronLeft" label="Previous week" onClick={() => go({ week: offset - 1 })} />
            <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => go({ week: 0 })}>
              This week
            </Button>
            <IconButton icon="chevronRight" label="Next week" onClick={() => go({ week: offset + 1 })} />
          </div>
        </div>
      </div>

      {data.error && !data.data ? (
        <ErrorState title="Couldn’t load the schedule" error={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <div className="schedule-loading">
          <Spinner label="Loading the week" />
        </div>
      ) : (
        <div className="week">
          {days.map((items, i) => {
            const date = new Date(start.getTime() + i * DAY);
            const isToday = date.getTime() === today.getTime();
            return (
              <section key={i} className={`day ${isToday ? 'is-today' : ''}`} aria-label={date.toLocaleDateString(undefined, { weekday: 'long' })}>
                <header className="day-head">
                  <span className="day-name">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span className="day-date num">{date.getDate()}</span>
                  {isToday && <span className="day-today">Today</span>}
                </header>
                <div className="day-items">
                  {items.length === 0 && <p className="day-empty faint">{scope === 'mine' ? 'Nothing from your library' : 'Nothing airs'}</p>}
                  {items.map((item) => {
                    const aired = item.airingAt * 1000 <= now;
                    return (
                      <Link
                        key={item.id}
                        to={aired ? `/watch/${item.media.id}/${item.episode}` : `/anime/${item.media.id}`}
                        className={`slot ${aired ? 'is-aired' : ''}`}
                        title={aired ? 'Watch this episode' : 'Not aired yet'}
                      >
                        <span className="slot-time num">{new Date(item.airingAt * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                        <div className="slot-body">
                          <Img src={item.media.coverImage?.medium ?? coverOf(item.media)} color={item.media.coverImage?.color} className="slot-cover" />
                          <div className="slot-text">
                            <span className="slot-title clamp-2">{titleOf(item.media, settings.titleLanguage)}</span>
                            <span className="slot-ep num">
                              Ep {item.episode}
                              {item.media.episodes ? ` / ${item.media.episodes}` : ''}
                              {mine.has(item.media.id) && <Icon name="bookmarkFilled" size={12} className="slot-mine" />}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
