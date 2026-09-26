/**
 * The PlayzAnime mark: a vermilion seal (hanko) with a carved P. The P's counter
 * is a play shape resting against the stem. The frame has two chips, the way a
 * hand-carved seal wears, so the mark never reads as a stock rounded square.
 */

export const P_PATH = 'M17 14H35A12.5 12.5 0 0 1 35 39H27V48L17 51Z';
export const COUNTER_PATH = 'M27 20.5V32.5L38.5 26.5Z';
// Inner frame drawn as two open strokes, leaving gaps top-right and bottom-left.
export const FRAME_PATHS = ['M40 8.5H51A4.5 4.5 0 0 1 55.5 13V44', 'M55.5 49V51A4.5 4.5 0 0 1 51 55.5H22', 'M16 55.5H13A4.5 4.5 0 0 1 8.5 51V13A4.5 4.5 0 0 1 13 8.5H35'];

interface LogoProps {
  size?: number;
  /** The inner frame lines are too fine below ~28px. */
  framed?: boolean;
  className?: string;
  title?: string;
}

export function Logo({ size = 32, framed = size >= 28, className, title = 'PlayzAnime' }: LogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
    >
      <rect x="2" y="2" width="60" height="60" rx="9" fill="var(--accent)" />
      {framed &&
        FRAME_PATHS.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--seal-carve)" strokeWidth="2.4" strokeLinecap="butt" />
        ))}
      <path d={`${P_PATH}${COUNTER_PATH}`} fill="var(--seal-carve)" fillRule="evenodd" />
    </svg>
  );
}
