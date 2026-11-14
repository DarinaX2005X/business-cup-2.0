'use client';

import { useId, type CSSProperties } from 'react';

/*
 * The keystone arch: a plain semicircular arch of wedge stones, hatched side stones
 * (the machine part of work) held by one solid apricot keystone (the human part).
 * 7 stones from 40 px, 5 from 20 px, 3 thick stones without hatching below 20 px.
 */

type Geometry = { wedges: string; key: string; keyY: number; keyH: number; hatch: string; stroke: number; edge: number };

const G7: Geometry = {
  wedges:
    'M2.5,48.5 A29.5 29.5 0 0 1 4.78,37.13 L18.4,43.48 A14.5 14.5 0 0 0 17.5,48.5ZM5.79,34.96 A29.5 29.5 0 0 1 12.13,26.69 L21.79,38.2 A14.5 14.5 0 0 0 19.41,41.31ZM13.97,25.15 A29.5 29.5 0 0 1 23.21,20.34 L27.1,34.85 A14.5 14.5 0 0 0 23.63,36.66ZM40.79,20.34 A29.5 29.5 0 0 1 50.03,25.15 L40.37,36.66 A14.5 14.5 0 0 0 36.9,34.85ZM51.87,26.69 A29.5 29.5 0 0 1 58.21,34.96 L44.59,41.31 A14.5 14.5 0 0 0 42.21,38.2ZM59.22,37.13 A29.5 29.5 0 0 1 61.5,48.5 L46.5,48.5 A14.5 14.5 0 0 0 45.6,43.48Z',
  key: 'M24.13,14.5 L39.87,14.5 L34.58,34.23 A14.5 14.5 0 0 0 29.42,34.23Z',
  keyY: 14.5,
  keyH: 1.76,
  hatch: hatchPath(5),
  stroke: 1.6,
  edge: 1.44,
};

const G5: Geometry = {
  wedges:
    'M2,49 A30 30 0 0 1 6.22,33.66 L20.36,43.2 A13 13 0 0 0 19,49ZM8.12,30.84 A30 30 0 0 1 19.2,21.87 L25.6,37.69 A13 13 0 0 0 22.27,40.38ZM44.8,21.87 A30 30 0 0 1 55.88,30.84 L41.73,40.38 A13 13 0 0 0 38.4,37.69ZM57.78,33.66 A30 30 0 0 1 62,49 L45,49 A13 13 0 0 0 43.64,43.2Z',
  key: 'M19.69,14 L44.31,14 L35.25,36.41 A13 13 0 0 0 28.75,36.41Z',
  keyY: 14,
  keyH: 2.64,
  hatch: hatchPath(7),
  stroke: 2.4,
  edge: 2.16,
};

/*
 * Icon sizes (under 20 px): three thick stones and a wide keystone, no hatching, solid
 * contrasting fills, so the arch still reads as an arch on a tab or a favicon.
 */
const G16: Geometry = {
  wedges: 'M1,50 A31 31 0 0 1 17.93,22.38 L27.91,41.98 A9 9 0 0 0 23,50ZM46.07,22.38 A31 31 0 0 1 63,50 L41,50 A9 9 0 0 0 36.09,41.98Z',
  key: 'M20.88,15.76 L43.12,15.76 L34.78,41.44 A9 9 0 0 0 29.22,41.44Z',
  keyY: 15.76,
  keyH: 3.6,
  hatch: '',
  stroke: 0,
  edge: 3.2,
};

const SMALL_FILL: Record<MarkTone, string> = {
  paper: 'oklch(56% 0.11 286)',
  violet: 'oklch(90% 0.045 288)',
  ink: 'var(--ink)',
  light: 'var(--on-violet)',
};

function hatchPath(step: number) {
  let d = '';
  for (let x = -70; x <= 70; x += step) d += `M${x} 70L${x + 70} 0`;
  return d;
}

export type MarkTone = 'paper' | 'violet' | 'ink' | 'light';

const tones: Record<MarkTone, CSSProperties> = {
  paper: { ['--m-field' as string]: 'oklch(82% 0.05 288)', ['--m-line' as string]: 'oklch(61% 0.09 286)', ['--m-key' as string]: 'var(--apricot-low)', ['--m-key-hi' as string]: 'var(--apricot-hi)' },
  violet: { ['--m-field' as string]: 'oklch(84% 0.07 288)', ['--m-line' as string]: 'oklch(66% 0.13 285)', ['--m-key' as string]: 'var(--apricot)', ['--m-key-hi' as string]: 'var(--apricot-hi)' },
  ink: { ['--m-field' as string]: 'transparent', ['--m-edge' as string]: 'var(--ink)', ['--m-line' as string]: 'var(--ink)', ['--m-key' as string]: 'var(--ink)', ['--m-key-hi' as string]: 'var(--ink)' },
  light: { ['--m-field' as string]: 'transparent', ['--m-edge' as string]: 'var(--on-violet)', ['--m-line' as string]: 'var(--on-violet)', ['--m-key' as string]: 'var(--on-violet)', ['--m-key-hi' as string]: 'var(--on-violet)' },
};

export function KeystoneMark({ size = 40, tone = 'paper', title, className, style }: { size?: number; tone?: MarkTone; title?: string; className?: string; style?: CSSProperties }) {
  const id = useId().replace(/:/g, '');
  const small = size < 20;
  const g = size >= 40 ? G7 : size >= 20 ? G5 : G16;
  const mono = tone === 'ink' || tone === 'light';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={{ ...tones[tone], ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={`${id}c`}>
          <path d={g.wedges} />
        </clipPath>
        <clipPath id={`${id}k`}>
          <path d={g.key} />
        </clipPath>
      </defs>
      <path d={g.wedges} style={small ? { fill: SMALL_FILL[tone] } : { fill: 'var(--m-field)', stroke: 'var(--m-edge, none)', strokeWidth: g.edge }} />
      {!small && (!mono || size >= 24) ? <path d={g.hatch} clipPath={`url(#${id}c)`} style={{ stroke: 'var(--m-line)', strokeWidth: g.stroke, fill: 'none' }} /> : null}
      <path d={g.key} style={{ fill: 'var(--m-key)' }} />
      <rect x="0" y={g.keyY} width="64" height={g.keyH} clipPath={`url(#${id}k)`} style={{ fill: 'var(--m-key-hi, var(--m-key))' }} />
    </svg>
  );
}

export function Wordmark({ size = 40, tone = 'paper', className }: { size?: number; tone?: MarkTone; className?: string }) {
  const color = tone === 'violet' || tone === 'light' ? 'var(--on-violet)' : 'var(--ink)';
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.28, fontWeight: 700, fontSize: size * 0.54, letterSpacing: '-0.03em', color, lineHeight: 1 }}
    >
      <KeystoneMark size={size} tone={tone} />
      Irreplaceable
    </span>
  );
}
