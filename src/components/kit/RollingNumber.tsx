'use client';

import { useEffect, useRef, useState } from 'react';
import { useKit } from './strings';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animates a number only when its value really changes (never on first render),
 * unless `from` is given, which rolls once from that value on mount (used after a scan).
 */
export function useRolling(value: number, { duration = 700, from }: { duration?: number; from?: number } = {}) {
  const [shown, setShown] = useState(from ?? value);
  const prev = useRef(from ?? value);
  const raf = useRef(0);

  useEffect(() => {
    const start = prev.current;
    if (start === value) return;
    if (reduced()) {
      prev.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const v = start + (value - start) * e;
      prev.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else prev.current = value;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return shown;
}

export function RollingNumber({ value, digits = 0, from, duration, className }: { value: number; digits?: number; from?: number; duration?: number; className?: string }) {
  const { num } = useKit();
  const v = useRolling(value, { from, duration });
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {num(v, digits)}
    </span>
  );
}
