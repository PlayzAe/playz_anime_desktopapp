import type { ReactNode, SVGProps } from 'react';

/*
 * PlayzAnime's own icon set, drawn on a 24px grid. The rules that make it ours:
 * square caps and mitred joins (no soft rounded strokes), and most icons carry
 * one solid block — a door, a poster, a knob — that anchors the glyph.
 */

const S = (d: string) => <path d={d} />;
const F = (d: string) => <path d={d} fill="currentColor" stroke="none" />;
const R = (x: number, y: number, w: number, h: number) => (
  <rect x={x} y={y} width={w} height={h} fill="currentColor" stroke="none" />
);

const glyphs = {
  home: (
    <>
      {S('M3.5 11 12 4l8.5 7')}
      {S('M5.5 9.5V20.5h13V9.5')}
      {R(10, 14, 4, 6.5)}
    </>
  ),
  heart: (
    <>
      {S('M12 20 4.2 12.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 7.8 5.8z')}
      {F('M12 20 4.2 12.4A4.6 4.6 0 0 1 12 6.6z')}
    </>
  ),
  tv: (
    <>
      <rect x="3.5" y="6.5" width="17" height="13" />
      {S('M8.5 3 12 6.5 15.5 3')}
      {F('M10 10.2v6l5-3z')}
    </>
  ),
  manga: (
    <>
      {S('M12 6.5C9 4.6 6.4 4.4 3.5 5.3v13.4c2.9-.9 5.5-.7 8.5 1.2')}
      {F('M12 6.5c3-1.9 5.6-2.1 8.5-1.2v13.4c-2.9-.9-5.5-.7-8.5 1.2z')}
    </>
  ),
  discover: (
    <>
      <rect x="3.5" y="3.5" width="7" height="10" />
      {R(13, 3, 8, 7)}
      <rect x="3.5" y="16.5" width="7" height="4" />
      <rect x="13.5" y="13" width="7" height="7.5" />
    </>
  ),
  schedule: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" />
      {S('M3.5 10h17')}
      {S('M8 3v4M16 3v4')}
      {R(13, 13.5, 4, 4)}
    </>
  ),
  library: (
    <>
      {S('M8 7H4.5v13.5h11V18')}
      <rect x="8" y="3.5" width="12" height="14.5" />
      {F('M11.5 3.5h5v8l-2.5-1.9-2.5 1.9z')}
    </>
  ),
  downloads: (
    <>
      {S('M12 3.5v8')}
      {F('M7.5 10 12 15l4.5-5z')}
      {S('M4 15.5v5h16v-5')}
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="m15.25 15.25 5 5" strokeWidth="2.6" />
    </>
  ),
  settings: (
    <>
      {S('M3.5 7.5h17M3.5 16.5h17')}
      {R(6.5, 4.75, 4.5, 5.5)}
      {R(13, 13.75, 4.5, 5.5)}
    </>
  ),
  history: (
    <>
      {S('M4.7 13.5A7.5 7.5 0 1 0 6.6 6.8')}
      {F('M3.5 3.5v5.5H9z')}
      {S('M12 8v4.5l3 2')}
    </>
  ),
  play: F('M6.5 4v16l13-8z'),
  pause: (
    <>
      {R(6, 4.5, 4, 15)}
      {R(14, 4.5, 4, 15)}
    </>
  ),
  next: (
    <>
      {F('M5 5v14l10-7z')}
      {R(16.5, 5, 2.5, 14)}
    </>
  ),
  prev: (
    <>
      {F('M19 5v14L9 12z')}
      {R(5, 5, 2.5, 14)}
    </>
  ),
  back10: (
    <>
      {S('M5.2 13.5A7 7 0 1 0 7.2 7')}
      {F('M4 3.8v5.4h5.4z')}
      <text x="12.4" y="15.6" fontSize="6.8" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
    </>
  ),
  fwd10: (
    <>
      {S('M18.8 13.5A7 7 0 1 1 16.8 7')}
      {F('M20 3.8v5.4h-5.4z')}
      <text x="11.6" y="15.6" fontSize="6.8" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
    </>
  ),
  volume: (
    <>
      {F('M3.5 9h3.8L12 5v14l-4.7-4H3.5z')}
      {S('M15.5 9a4.2 4.2 0 0 1 0 6')}
      {S('M18 6.5a7.8 7.8 0 0 1 0 11')}
    </>
  ),
  volumeLow: (
    <>
      {F('M3.5 9h3.8L12 5v14l-4.7-4H3.5z')}
      {S('M15.5 9a4.2 4.2 0 0 1 0 6')}
    </>
  ),
  mute: (
    <>
      {F('M3.5 9h3.8L12 5v14l-4.7-4H3.5z')}
      {S('m15.5 9.5 5 5M20.5 9.5l-5 5')}
    </>
  ),
  fullscreen: S('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  fullscreenExit: S('M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5'),
  pip: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" />
      {R(12, 12, 7, 5)}
    </>
  ),
  subtitles: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" />
      {S('M7 11.5h3.5M13 11.5h4M7 15h6.5M16 15h1')}
    </>
  ),
  theater: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" />
      {R(2.5, 15.5, 19, 2)}
    </>
  ),
  skip: S('M5 6l6 6-6 6M12.5 6l6 6-6 6'),
  speed: (
    <>
      {S('M4.2 16.5A8.5 8.5 0 1 1 19.8 16.5')}
      {F('M11 12.8 16.5 8l-3.7 6.3z')}
    </>
  ),
  arrowLeft: S('M20 12H5M11 5.5 4.5 12l6.5 6.5'),
  arrowRight: S('M4 12h15M13 5.5l6.5 6.5-6.5 6.5'),
  chevronLeft: S('M14.5 5.5 8 12l6.5 6.5'),
  chevronRight: S('M9.5 5.5 16 12l-6.5 6.5'),
  chevronDown: S('M5.5 9 12 15.5 18.5 9'),
  close: S('M6 6l12 12M18 6 6 18'),
  check: S('M4.5 12.5 9.5 17.5 19.5 6.5'),
  plus: S('M12 4.5v15M4.5 12h15'),
  minus: S('M4.5 12h15'),
  bookmark: S('M6.5 3.5h11v17l-5.5-4-5.5 4z'),
  bookmarkFilled: F('M6 3h12v18l-6-4.4L6 21z'),
  folder: S('M3.5 6h6l2 2.5h9v11h-17z'),
  external: S('M13.5 4.5h6v6M19.5 4.5l-8 8M17 14v5.5H4.5V7H10'),
  trash: S('M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14'),
  refresh: (
    <>
      {S('M19.3 10.5A7.5 7.5 0 1 0 17.4 17')}
      {F('M20.5 4v5.5H15z')}
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {S('M12 11v6')}
      {R(11, 7, 2, 2)}
    </>
  ),
  alert: (
    <>
      {S('M12 3.5 21 19.5H3z')}
      {S('M12 9.5v5')}
      {R(11, 16, 2, 2)}
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {S('M3.5 12h17M12 3.5c2.4 2.4 3.4 5.3 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.3-3.4-8.5s1-6.1 3.4-8.5z')}
    </>
  ),
  bolt: F('M13 2.5 5 13.5h6l-1 8 8-11h-6z'),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      {S('M12 7.5V12l3 2')}
    </>
  ),
  filter: S('M4 5.5h16l-6.5 7.5v6L10.5 21v-8z'),
  list: S('M4 6.5h16M4 12h16M4 17.5h10'),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" />
      {R(13.5, 13.5, 6.5, 6.5)}
    </>
  ),
  more: (
    <>
      {R(4, 10.5, 3, 3)}
      {R(10.5, 10.5, 3, 3)}
      {R(17, 10.5, 3, 3)}
    </>
  ),
  eye: (
    <>
      {S('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z')}
      {R(10, 10, 4, 4)}
    </>
  ),
  sort: S('M7 4v16M3.5 16.5 7 20l3.5-3.5M13 6.5h7.5M13 12h5.5M13 17.5h3'),
  profile: (
    <>
      {R(8.5, 3.5, 7, 7)}
      {S('M4.5 20.5v-3a3.5 3.5 0 0 1 3.5-3.5h8a3.5 3.5 0 0 1 3.5 3.5v3')}
    </>
  ),
  profiles: (
    <>
      <rect x="12.5" y="3.5" width="6" height="6" />
      {S('M14.5 13h2.5a3 3 0 0 1 3 3v3')}
      {R(5, 7, 6, 6)}
      {S('M2.5 20.5v-1.5a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v1.5')}
    </>
  ),
  share: (
    <>
      {S('M12 14.5V4.5')}
      {F('M7.5 9 12 3.5 16.5 9z')}
      {S('M8 12.5H4.5v8h15v-8H16')}
    </>
  ),
  shield: (
    <>
      {S('M12 3 19.5 6v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z')}
      {F('M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5z')}
    </>
  ),
  offline: (
    <>
      {S('M3.5 9.2a12 12 0 0 1 17 0M6.8 12.6a7.3 7.3 0 0 1 10.4 0')}
      {R(10, 15.5, 4, 4)}
      {S('M4 3.5 20 20.5')}
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" />
      {F('M3.5 19.5 9 12.5l4 4.5 2.5-2.5 5 5z')}
      {R(14.5, 7.5, 3, 3)}
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" />
      {S('M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7.5 14.5h9')}
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof glyphs;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'stroke'> {
  name: IconName;
  size?: number;
  stroke?: number;
}

export function Icon({ name, size = 20, stroke = 1.7, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyphs[name]}
    </svg>
  );
}
