'use client';

import { useEffect, useState } from 'react';
import type { Locale, WeekShare } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';
import type { Bundle, ResumeAnalysis, SampleName, SearchResponse, TaskTexts, WeekProposal } from './types';

/*
 * Client calls of the /start flow. Everything goes through apiFetch so errors carry the server's
 * `code` (shown from `common.errors.*` or `start.*`). Static occupation bundles are cached per tab.
 */

const searchCache = new Map<string, SearchResponse>();

export async function searchOccupations(q: string, locale: Locale, signal?: AbortSignal): Promise<SearchResponse> {
  const key = `${locale}:${q.trim().toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit) return hit;
  const res = await apiFetch<SearchResponse>(`/api/occupations/search?q=${encodeURIComponent(q.trim())}&locale=${locale}`, { signal, profile: null });
  if (!res.hint) searchCache.set(key, res);
  return res;
}

export function analyzeText(text: string, mode: 'resume' | 'description', locale: Locale, signal?: AbortSignal) {
  return apiFetch<ResumeAnalysis>('/api/xray/resume', { method: 'POST', body: { text, mode, locale }, signal });
}

export async function loadSample(name: SampleName): Promise<string> {
  const res = await apiFetch<{ text: string }>(`/api/xray/sample?name=${name}`, { profile: null });
  return res.text;
}

export function proposeWeek(occupationCode: string, duties: { original: string; en: string }[] | null, locale: Locale) {
  return apiFetch<WeekProposal>('/api/xray/week', { method: 'POST', body: { occupationCode, duties: duties?.length ? duties : null, locale } });
}

const bundles = new Map<string, Promise<Bundle>>();

export function loadBundle(code: string): Promise<Bundle> {
  let p = bundles.get(code);
  if (!p) {
    p = fetch(`/data/occ/${encodeURIComponent(code)}.json`).then((r) => {
      if (!r.ok) throw new Error(`bundle ${code}: ${r.status}`);
      return r.json() as Promise<Bundle>;
    });
    p.catch(() => bundles.delete(code));
    bundles.set(code, p);
  }
  return p;
}

/** The occupation bundle, or null while it loads (and on failure, with `error`). */
export function useBundle(code: string | null) {
  const [state, setState] = useState<{ code: string | null; bundle: Bundle | null; error: boolean }>({ code: null, bundle: null, error: false });
  useEffect(() => {
    if (!code) return;
    let live = true;
    loadBundle(code).then(
      (bundle) => live && setState({ code, bundle, error: false }),
      () => live && setState({ code, bundle: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [code]);
  return state.code === code ? state : { code, bundle: null, error: false };
}

/**
 * Task texts and short labels in the person's language. Until the generated labels exist the server
 * answers with English text and a heuristic label (`ready: false`); we ask again a few times so the
 * translations replace the English in place.
 */
export function useTaskTexts(code: string | null, locale: Locale): TaskTexts | null {
  const [texts, setTexts] = useState<{ key: string; value: TaskTexts } | null>(null);
  const key = `${code}:${locale}`;
  useEffect(() => {
    if (!code) return;
    let live = true;
    let tries = 0;
    let timer = 0;
    const run = () => {
      apiFetch<TaskTexts>(`/api/occupations/${encodeURIComponent(code)}/texts?locale=${locale}`, { profile: null })
        .then((value) => {
          if (!live) return;
          setTexts({ key, value });
          if (!value.ready && ++tries < 6) timer = window.setTimeout(run, 5000);
        })
        .catch(() => {
          if (live && ++tries < 3) timer = window.setTimeout(run, 4000);
        });
    };
    run();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [code, locale, key]);
  return texts?.key === key ? texts.value : null;
}

/* ---------- the first frame handed to /x/[id] ---------- */

/**
 * After the scan the week map page draws this as its first frame, so the transition has no flash.
 * Contract for 02.3: sessionStorage `irr:xray-frame` = { id, xray, short, savedAt }; read once and remove.
 */
export const FIRST_FRAME_KEY = 'irr:xray-frame';

export function saveFirstFrame(frame: { id: string; xray: unknown; short: Record<string, string> }) {
  try {
    window.sessionStorage.setItem(FIRST_FRAME_KEY, JSON.stringify({ ...frame, savedAt: new Date().toISOString() }));
  } catch {
    /* storage blocked: the map page loads normally */
  }
}

/* ---------- draft of the flow, so a reload or the Back button keeps the work ---------- */

const DRAFT_KEY = 'irr:start-draft';

export function readDraft<T>(): T | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(draft: unknown) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage blocked: the flow still works, a reload starts over */
  }
}

export function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** True when this browser refuses to keep anything (private mode with storage blocked). */
export function storageBlocked(): boolean {
  try {
    const k = 'irr:probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return false;
  } catch {
    return true;
  }
}

export function sharesEqual(a: WeekShare[], b: WeekShare[]) {
  return a.length === b.length && a.every((s, i) => s.taskId === b[i].taskId && s.share === b[i].share);
}
