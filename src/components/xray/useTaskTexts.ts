'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';
import type { TaskTexts, TaskTip } from './types';

const TEXTS_POLL_MS = 4000;
const TIPS_POLL_MS = 3000;
/** After this the tips block is hidden without a word; the map is complete without it. */
const TIPS_GIVE_UP_MS = 30_000;

/**
 * Task labels and translations for the interface language. The server renders what it has; while the
 * generated labels are not ready we poll quietly and swap the words in place (rows keep their height).
 */
export function useTaskTexts(code: string, locale: Locale, initial: { texts: TaskTexts; ready: boolean; locale: Locale }) {
  const [fetched, setFetched] = useState<{ locale: Locale; texts: TaskTexts; ready: boolean } | null>(null);
  const current = fetched?.locale === locale ? fetched : initial.locale === locale ? initial : null;
  const needFetch = !current || !current.ready;

  useEffect(() => {
    if (!needFetch) return;
    let stop = false;
    let timer = 0;
    const started = Date.now();
    const load = async () => {
      try {
        const r = await apiFetch<{ tasks: TaskTexts; ready: boolean }>(`/api/occupations/${encodeURIComponent(code)}/texts?locale=${locale}`, { profile: null });
        if (stop) return;
        setFetched({ locale, texts: r.tasks, ready: r.ready });
        if (r.ready) return;
      } catch {
        if (stop) return;
      }
      if (Date.now() - started < 60_000) timer = window.setTimeout(load, TEXTS_POLL_MS);
    };
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [code, locale, needFetch]);

  return current?.texts ?? fetched?.texts ?? initial.texts;
}

export type TipsState = { status: 'pending' } | { status: 'ready'; tips: Record<string, TaskTip> } | { status: 'hidden' };

/** Tips per task from /api/xray/tips: pending while the model writes them (up to 30 s), then shown or hidden. */
export function useTips(code: string, locale: Locale): TipsState {
  const [state, setState] = useState<{ key: string; value: TipsState } | null>(null);
  const key = `${code}:${locale}`;

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const started = Date.now();
    const set = (value: TipsState) => !stop && setState({ key, value });
    const load = async () => {
      try {
        const r = await apiFetch<{ tips?: Record<string, TaskTip>; pending?: boolean; unavailable?: boolean }>(
          `/api/xray/tips?code=${encodeURIComponent(code)}&locale=${locale}`,
          { profile: null },
        );
        if (stop) return;
        if (r.tips) return set({ status: 'ready', tips: r.tips });
        if (r.unavailable) return set({ status: 'hidden' });
      } catch {
        if (stop) return;
      }
      if (Date.now() - started >= TIPS_GIVE_UP_MS) return set({ status: 'hidden' });
      timer = window.setTimeout(load, TIPS_POLL_MS);
    };
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [code, locale, key]);

  return state?.key === key ? state.value : { status: 'pending' };
}
