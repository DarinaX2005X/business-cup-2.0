'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const noop = () => () => undefined;
/** True only after hydration (timers and local time never render on the server). */
export function useMounted() {
  return useSyncExternalStore(noop, () => true, () => false);
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** A remembered on/off preference of this browser (for example «Hide timer»). */
export function useLocalFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    setValue(readFlag(key));
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
    },
    [key],
  );
  return [value, set];
}

/** Seconds since the rep was opened in this tab; stops when `running` turns false. Client only. */
export function useElapsed(running: boolean): number {
  const start = useRef<number | null>(null);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    start.current ??= Date.now();
    const tick = () => setSec(Math.floor((Date.now() - (start.current ?? Date.now())) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return sec;
}

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/** Milliseconds until the next local midnight, refreshed every 30 s (null before hydration). */
export function useUntilMidnight(): number | null {
  const mounted = useMounted();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!mounted) return null;
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return Math.max(0, next - now);
}

/** Monday-first week of the visitor's local calendar: which days have practice, and today's index. */
export function weekOf(days: string[], exclude?: string): { done: boolean[]; today: number } {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const set = new Set(days.filter((d) => d !== exclude));
  const done = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - today + i);
    return set.has(localKey(d));
  });
  return { done, today };
}

export function localKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Keeps an editable element above the on-screen keyboard: on phones the visual viewport shrinks when the
 * keyboard opens; the returned offset is how far the layout viewport's bottom sits below the visible area.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [active]);
  return inset;
}
