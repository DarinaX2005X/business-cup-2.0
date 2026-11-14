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
  variant?: 'arc' | 'strip';
  surface?: Surface;
  size?: number;
  label?: string;
  hint?: string;
}

/**
 * The Irreplaceability score: a big number on an apricot half-ring (or a short apricot strip
 * on a dashed 0–100 ruler). It rolls only when the value really changes.
 */
export function ScoreDial({ value, delta, variant = 'arc', surface = 'paper', size = 260, label, hint }: ScoreDialProps) {
  const { s, num } = useKit();
  const id = useId().replace(/:/g, '');
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
  const deltaChip = delta ? (
    <span key={pulse} className={st.delta} data-neg={delta < 0 || undefined}>
      {delta > 0 ? '+' : '−'}
      {num(Math.abs(delta))}
    </span>
  ) : null;

  if (variant === 'strip') {
    return (
      <div className={st.strip} data-surface={surface} role="img" aria-label={`${lab}: ${value} ${s.outOf}${delta ? `, ${delta > 0 ? '+' : ''}${delta}` : ''}`}>
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

  const W = 240;
  const r = 100;
  const cx = W / 2;
  const cy = 118;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const p = Math.max(0, Math.min(100, v));
  return (
    <div className={st.dial} data-surface={surface} style={{ width: size, '--dial': `${size}px` } as CSSProperties} role="img" aria-label={`${lab}: ${value} ${s.outOf}${delta ? `, ${delta > 0 ? '+' : ''}${delta}` : ''}`}>
      <div className={st.dialArc}>
      <svg viewBox={`0 0 ${W} 132`} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--apricot-hi)' }} />
            <stop offset="0.5" style={{ stopColor: 'var(--apricot)' }} />
            <stop offset="1" style={{ stopColor: 'var(--apricot-low)' }} />
          </linearGradient>
        </defs>
        <path d={arc} className={st.track} pathLength={100} />
        {[0, 25, 50, 75, 100].map((t) => {
          const a = Math.PI * (1 - t / 100);
          const x1 = cx + Math.cos(a) * (r + 15);
          const y1 = cy - Math.sin(a) * (r + 15);
          const x2 = cx + Math.cos(a) * (r + 20);
          const y2 = cy - Math.sin(a) * (r + 20);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className={st.tick} />;
        })}
        {p > 0 ? (
          <>
            <path d={arc} className={st.face} pathLength={100} strokeDasharray={`${p} 100`} transform="translate(0 5)" />
            <path d={arc} className={st.fill} pathLength={100} strokeDasharray={`${p} 100`} stroke={`url(#${id}g)`} />
            <path d={`M ${cx - r - 7} ${cy} A ${r + 7} ${r + 7} 0 0 1 ${cx + r + 7} ${cy}`} className={st.gloss} pathLength={100} strokeDasharray={`${Math.max(0, p - 1)} 100`} />
          </>
        ) : null}
      </svg>
      <div className={st.dialNum}>
        <span className={st.dialV}>{num(shown)}</span>
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
