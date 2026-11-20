// The Arch mark: a Roman arch. The voussoirs (wedge stones) only stand because the
// keystone locks them in place, which is how decisions, actions and standards hold
// the structure up. Stones use currentColor; the keystone uses the accent colour.
// The same geometry is in public/arch.svg (favicon).

const STONES =
  'M44.50 32.38L55.50 32.27A23.5 23.5 0 0 0 54.16 24.67L43.79 28.34A12.5 12.5 0 0 1 44.50 32.38ZM43.70 28.11L54.00 24.25A23.5 23.5 0 0 0 50.15 17.57L41.65 24.56A12.5 12.5 0 0 1 43.70 28.11ZM41.50 24.37L49.86 17.22A23.5 23.5 0 0 0 43.94 12.26L38.35 21.74A12.5 12.5 0 0 1 41.50 24.37ZM38.15 21.62L43.55 12.04A23.5 23.5 0 0 0 36.30 9.40L34.29 20.21A12.5 12.5 0 0 1 38.15 21.62ZM29.71 20.21L27.70 9.40A23.5 23.5 0 0 0 20.45 12.04L25.85 21.62A12.5 12.5 0 0 1 29.71 20.21ZM25.65 21.74L20.06 12.26A23.5 23.5 0 0 0 14.14 17.22L22.50 24.37A12.5 12.5 0 0 1 25.65 21.74ZM22.35 24.56L13.85 17.57A23.5 23.5 0 0 0 10.00 24.25L20.30 28.11A12.5 12.5 0 0 1 22.35 24.56ZM20.21 28.34L9.84 24.67A23.5 23.5 0 0 0 8.50 32.27L19.50 32.38A12.5 12.5 0 0 1 20.21 28.34ZM8.5 33.6H19.5V42.5H8.5ZM8.5 43.6H19.5V53.0H8.5ZM44.5 33.6H55.5V42.5H44.5ZM44.5 43.6H55.5V53.0H44.5ZM6.0 54.1H58.0V57.0H6.0Z';
const KEYSTONE = 'M34.05 20.17L36.22 7.15A25.7 25.7 0 0 0 27.78 7.15L29.95 20.17A12.5 12.5 0 0 1 34.05 20.17Z';

export function ArchMark({ size = 24, title = 'Arch' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} className="arch-mark">
      <path fill="currentColor" d={STONES} />
      <path fill="var(--accent)" d={KEYSTONE} />
    </svg>
  );
}
