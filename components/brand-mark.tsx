/**
 * The atakan.fm mark: four pill bars on a shared baseline.
 *
 * It is a bar chart rather than the usual centred equaliser, because a bar chart
 * is what this site actually shows — plays counted over time. The heights follow
 * an uneven rhythm so the mark reads as data instead of decoration, and four bars
 * is the most that stays legible once a browser renders the favicon at 16px.
 *
 * The same geometry is duplicated in `app/icon.svg`, which cannot import from
 * here. Keep the two in step.
 */

// x, y, height — width 4, radius 2, baseline at y=27 on a 32x32 grid.
const BARS = [
  { x: 3.5, y: 19, height: 8 },
  { x: 10.5, y: 6, height: 21 },
  { x: 17.5, y: 14, height: 13 },
  { x: 24.5, y: 10, height: 17 },
];

export function BrandMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={size}
      viewBox="0 0 32 32"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {BARS.map((bar) => (
        <rect key={bar.x} height={bar.height} rx="2" width="4" x={bar.x} y={bar.y} />
      ))}
    </svg>
  );
}
