import type { Media, MediaFormat, MediaSeason, MediaSnapshot, MediaStatus, Settings } from '../../shared/types';

type TitleLang = Settings['titleLanguage'];

export function titleOf(m: Pick<Media, 'title'>, lang: TitleLang = 'english'): string {
  const t = m.title;
  return (lang === 'english' ? t.english || t.romaji : t.romaji || t.english) || t.userPreferred || t.native || 'Untitled';
}

/** The other-language title, shown small under the main one when it differs. */
export function altTitleOf(m: Pick<Media, 'title'>, lang: TitleLang = 'english'): string | null {
  const main = titleOf(m, lang);
  const other = lang === 'english' ? m.title.romaji : m.title.english;
  return other && other.toLowerCase() !== main.toLowerCase() ? other : null;
}

export function coverOf(m: Pick<Media, 'coverImage'>): string {
  return m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || '';
}

/** Grid-sized cover: the 230px 'large' file is plenty for a 160px card when saving data. */
export function posterOf(m: Pick<Media, 'coverImage'>, dataSaver: boolean): string {
  return (dataSaver && m.coverImage?.large) || coverOf(m);
}

export function snapshot(m: Media, lang: TitleLang = 'english'): MediaSnapshot {
  return {
    id: m.id,
    type: m.type ?? (m.chapters || m.format === 'MANGA' || m.format === 'ONE_SHOT' ? 'MANGA' : 'ANIME'),
    chapters: m.chapters ?? null,
    title: titleOf(m, lang),
    romaji: m.title.romaji ?? null,
    native: m.title.native ?? null,
    cover: coverOf(m),
    banner: m.bannerImage ?? null,
    color: m.coverImage?.color ?? null,
    format: m.format ?? null,
    episodes: m.episodes ?? null,
    year: m.seasonYear ?? m.startDate?.year ?? null,
    status: m.status ?? null,
  };
}

const FORMATS: Record<MediaFormat, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
  MANGA: 'Manga',
  NOVEL: 'Novel',
  ONE_SHOT: 'One-shot',
};

export const formatLabel = (f?: MediaFormat | null) => (f ? FORMATS[f] ?? f : null);

/** Manga from Korea and China read as manhwa and manhua. */
export function mangaKind(m: Pick<Media, 'format' | 'countryOfOrigin'>): string | null {
  if (m.format === 'ONE_SHOT') return 'One-shot';
  if (m.countryOfOrigin === 'KR') return 'Manhwa';
  if (m.countryOfOrigin === 'CN' || m.countryOfOrigin === 'TW') return 'Manhua';
  return m.format === 'MANGA' ? 'Manga' : formatLabel(m.format);
}

export const isManga = (m: Pick<Media, 'type' | 'format'>) =>
  m.type === 'MANGA' || m.format === 'MANGA' || m.format === 'ONE_SHOT' || m.format === 'NOVEL';

export const mediaPath = (m: Pick<Media, 'id' | 'type' | 'format'>) => (isManga(m) ? `/manga/${m.id}` : `/anime/${m.id}`);

const STATUSES: Record<MediaStatus, string> = {
  FINISHED: 'Finished',
  RELEASING: 'Airing',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};

export const statusLabel = (s?: MediaStatus | null) => (s ? STATUSES[s] ?? s : null);

export const seasonName = (s: MediaSeason) => s.charAt(0) + s.slice(1).toLowerCase();

export function seasonLabel(m: Pick<Media, 'season' | 'seasonYear' | 'startDate'>): string | null {
  if (m.season && m.seasonYear) return `${seasonName(m.season)} ${m.seasonYear}`;
  const y = m.seasonYear ?? m.startDate?.year;
  return y ? String(y) : null;
}

export const scoreLabel = (avg?: number | null) => (avg ? (avg / 10).toFixed(1) : null);

export function episodesLabel(m: Pick<Media, 'episodes' | 'format' | 'nextAiringEpisode' | 'status' | 'chapters' | 'type'>): string | null {
  if (isManga(m)) return m.chapters ? `${m.chapters} ch` : null;
  if (m.format === 'MOVIE') return null;
  if (m.episodes) return `${m.episodes} ep${m.episodes === 1 ? '' : 's'}`;
  if (m.nextAiringEpisode) return `${m.nextAiringEpisode.episode - 1} eps so far`;
  return null;
}

/** "2d 4h", "5h 12m", "12m" */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** "3 min ago", "5 h ago", "yesterday", "12 Sep" */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = (now - ms) / 1000;
  if (diff < 0) return `in ${countdown(-diff)}`;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Player clock: 4:05, 23:40, 1:02:13 */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function bytes(n: number): string {
  if (!n) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i < 2 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** AniList descriptions carry <br>, <i> and entities even with asHtml:false. */
export function plainText(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\(Source:[^)]*\)\s*$/i, '')
    .trim();
}

export function mediaYear(m: Pick<Media, 'seasonYear' | 'startDate'>): number | null {
  return m.seasonYear ?? m.startDate?.year ?? null;
}

/** A translucent tint from AniList's dominant cover colour, for image placeholders. */
export function tint(color?: string | null, alpha = 0.28): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return 'var(--ink-2)';
  const n = parseInt(color.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}
