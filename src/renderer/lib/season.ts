import type { MediaSeason } from '../../shared/types';

/** The AniList season airing now (mirrors the main process helper). */
export function currentSeasonLabel(date = new Date()): { season: MediaSeason; year: number } {
  const m = date.getMonth();
  const season: MediaSeason = m <= 2 ? 'WINTER' : m <= 5 ? 'SPRING' : m <= 8 ? 'SUMMER' : 'FALL';
  return { season, year: date.getFullYear() };
}
