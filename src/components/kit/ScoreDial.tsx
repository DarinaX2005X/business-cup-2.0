'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useRolling } from './RollingNumber';
import { useKit } from './strings';
import type { Surface } from './types';
import st from './rewards.module.css';

export interface ScoreDialProps {
  value: number;
  /** Shown as «+2» next to the number when the score just moved. */
  delta?: number;
  /**
   * `arch` (default): the keystone arch of the mark is the score. Side stones fill with the
   * human part from both feet upward as the score grows; the keystone lights at high scores.
   * `compact`: the same arch at header size with the number beside it.
   * `strip`: the number with a short apricot strip on a dashed 0–100 ruler.
   * `arc` is kept for older callers and draws the arch.
   */
  variant?: 'arch' | 'compact' | 'strip' | 'arc';
  surface?: Surface;
  size?: number;
  label?: string;
  hint?: string;
}

/* Keystone arch geometry, the same stones as the 7-stone mark (centre 32, 48.5). */
const CX = 32;
const CY = 48.5;
const STONES = [
  'M2.5,48.5 A29.5 29.5 0 0 1 4.78,37.13 L18.4,43.48 A14.5 14.5 0 0 0 17.5,48.5Z',
  'M5.79,34.96 A29.5 29.5 0 0 1 12.13,26.69 L21.79,38.2 A14.5 14.5 0 0 0 19.41,41.31Z',
  'M13.97,25.15 A29.5 29.5 0 0 1 23.21,20.34 L27.1,34.85 A14.5 14.5 0 0 0 23.63,36.66Z',
  'M40.79,20.34 A29.5 29.5 0 0 1 50.03,25.15 L40.37,36.66 A14.5 14.5 0 0 0 36.9,34.85Z',
  'M51.87,26.69 A29.5 29.5 0 0 1 58.21,34.96 L44.59,41.31 A14.5 14.5 0 0 0 42.21,38.2Z',
  'M59.22,37.13 A29.5 29.5 0 0 1 61.5,48.5 L46.5,48.5 A14.5 14.5 0 0 0 45.6,43.48Z',
];
const KEY = 'M24.13,14.5 L39.87,14.5 L34.58,34.23 A14.5 14.5 0 0 0 29.42,34.23Z';
/** The keystone lights from this score; the side stones fill up to it. */
const KEY_AT = 85;
/** Angle (from the horizontal) where the third side stone ends. */
const SIDE_TOP = 73;

/** A triangle from the arch centre that sweeps from the foot up to `deg` on one side. */
function sweep(deg: number, side: -1 | 1) {
  const R = 90;
  const a0 = (-3 * Math.PI) / 180;
  const a1 = (deg * Math.PI) / 180;
  const p = (a: number) => `${(CX + side * Math.cos(a) * R).toFixed(2)},${(CY - Math.sin(a) * R).toFixed(2)}`;
  const mid = (a0 + a1) / 2;
  return `M${CX},${CY} L${p(a0)} L${p(mid)} L${p(a1)} Z`;
}

function KeystoneArch({ v, uid, surface }: { v: number; uid: string; surface: Surface }) {
  const deg = Math.min(1, Math.max(0, v) / KEY_AT) * SIDE_TOP;
  const keyLit = v >= KEY_AT;
  return (
    <svg viewBox="0 9 64 44" className={st.archSvg} data-surface={surface} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}hu`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--apricot-hi)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--apricot)' }} />
          <stop offset="1" style={{ stopColor: 'var(--apricot-low)' }} />
        </linearGradient>
        <pattern id={`${uid}h`} width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.42" height="2.4" className={st.archHatch} />
        </pattern>
        <clipPath id={`${uid}c`}>
          {deg > 0 ? (
            <>
              <path d={sweep(deg, -1)} />
              <path d={sweep(deg, 1)} />
            </>
          ) : (
            <rect width="0" height="0" />
          )}
        </clipPath>
      </defs>
      {/* empty stones: the machine part, hatched paper */}
      <g className={st.archEmpty}>
        {STONES.map((d) => (
          <path key={d} d={d} />
        ))}
        <path d={KEY} />
      </g>
      <g className={st.archHatchLayer} fill={`url(#${uid}h)`}>
        {STONES.map((d) => (
          <path key={d} d={d} />
        ))}
        <path d={KEY} />
      </g>
      {/* filled stones: the human part, apricot with volume, growing from the feet upward */}
      <g clipPath={`url(#${uid}c)`} className={st.archFill}>
        {STONES.map((d) => (
          <path key={d} d={d} fill={`url(#${uid}hu)`} />
        ))}
      </g>
      <g className={st.archKey} data-lit={keyLit || undefined}>
        <path d={KEY} fill={`url(#${uid}hu)`} />
        <path d="M24.13,14.5 L39.87,14.5 L39.4,16.26 L24.6,16.26Z" className={st.archKeyHi} />
      </g>
    </svg>
  );
}

/**
 * The Irreplaceability score as the product's own object: the keystone arch of the mark.
 * Rolls only when the value really changes.
 */
export function ScoreDial({ value, delta, variant = 'arch', surface = 'paper', size = 260, label, hint }: ScoreDialProps) {
  const { s, num } = useKit();
  const uid = useId().replace(/:/g, '');
  const v = useRolling(value, { duration: 900 });
  const shown = Math.round(v);
  const [pulse, setPulse] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) setPulse((p) => p + 1);
    prev.current = value;
  }, [value]);

  const lab = label ?? s.score;
  const sub = hint ?? s.scoreHint;
  const aria = `${lab}: ${value} ${s.outOf}${delta ? `, ${delta > 0 ? '+' : ''}${delta}` : ''}`;
  const deltaChip = delta ? (
    <span key={pulse} className={st.delta} data-neg={delta < 0 || undefined}>
      {delta > 0 ? '+' : '−'}
      {num(Math.abs(delta))}
    </span>
  ) : null;

  if (variant === 'strip') {
    return (
      <div className={st.strip} data-surface={surface} role="img" aria-label={aria}>
        <div className={st.stripTop}>
          <span className={st.stripV}>{num(shown)}</span>
          <span className={st.stripK}>
            {lab}
            <span>{sub}</span>
          </span>
          {deltaChip}
        </div>
        <div className={st.ruler} aria-hidden="true">
          <i style={{ width: `${Math.max(2, v)}%` }} />
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={st.archCompact} data-surface={surface} role="img" aria-label={aria}>
        <span className={st.archCompactArt} style={{ width: Math.min(size, 72) }}>
          <KeystoneArch v={v} uid={uid} surface={surface} />
        </span>
        <span className={st.archCompactV}>{num(shown)}</span>
        <span className={st.archCompactK}>{lab}</span>
        {deltaChip}
      </div>
    );
  }

  return (
    <div className={st.arch} data-surface={surface} style={{ width: size, '--dial': `${size}px` } as CSSProperties} role="img" aria-label={aria}>
      <div className={st.archStage}>
        <KeystoneArch v={v} uid={uid} surface={surface} />
        <div className={st.archNum}>
          <span className={st.archV}>{num(shown)}</span>
          {deltaChip}
        </div>
      </div>
      <div className={st.dialK}>
        {lab}
        <span>{sub}</span>
      </div>
    </div>
  );
}
