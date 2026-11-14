'use client';

import { useEffect, useRef, useState } from 'react';
import { useKit } from './strings';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animates a number only when its value really changes (never on first render),
 * unless `from` is given, which rolls once from that value on mount (used after a scan).
 */
export function useRolling(value: number, { duration = 700, from, delay = 0 }: { duration?: number; from?: number; delay?: number } = {}) {
  const [shown, setShown] = useState(from ?? value);
  const prev = useRef(from ?? value);
  const raf = useRef(0);

  useEffect(() => {
    const start = prev.current;
    if (start === value) return;
    const dur = reduced() ? 0 : duration;
    let t0 = 0;
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      if (!t0) t0 = t;
      const k = dur ? Math.min(1, (t - t0) / dur) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      const v = start + (value - start) * e;
      prev.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else prev.current = value;
    };
    const timer = window.setTimeout(() => {
      raf.current = requestAnimationFrame(step);
    }, dur ? delay : 0);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf.current);
    };
  }, [value, duration, delay]);

  return shown;
}

export function RollingNumber({ value, digits = 0, from, duration, delay, className }: { value: number; digits?: number; from?: number; duration?: number; delay?: number; className?: string }) {
  const { num } = useKit();
  const v = useRolling(value, { from, duration, delay });
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {num(v, digits)}
    </span>
  );
}
