'use client';

import type { Locale, PointsAward, RepType } from '@/domain/types';
import { ApiError, apiFetch } from '@/lib/client/api';
import type { PlaybookCard, PlaybookView, SecondLookResult, SecondLookState } from '@/server/playbook/types';

/* Client side of /api/playbook and /api/second-look (05.3). Shapes: src/server/playbook/types.ts. */

export type { PlaybookCard, PlaybookView, SecondLookResult, SecondLookState };

export const loadPlaybook = (locale: Locale) => apiFetch<PlaybookView>(`/api/playbook?locale=${locale}`);

const taskPath = (taskId: string) => `/api/playbook/${encodeURIComponent(taskId)}`;

export const saveEdit = (taskId: string, text: string, locale: Locale) =>
  apiFetch<{ card: PlaybookCard }>(taskPath(taskId), { method: 'PUT', body: { text, locale } }).then((r) => r.card);

export const clearEdit = (taskId: string, locale: Locale) => apiFetch<{ card: PlaybookCard }>(`${taskPath(taskId)}?locale=${locale}`, { method: 'DELETE' }).then((r) => r.card);

export const recordCopy = (taskId: string) => apiFetch<{ pointsAwarded: PointsAward[]; copiedToday: boolean }>(`${taskPath(taskId)}/copy`, { method: 'POST' });

type RepStart = { rep: { id: string } } | { status: 'generating'; repId: string };

/**
 * «Practise this»: a Delegate rep on this task. Today's daily rep when it is still free, otherwise a
 * practice rep. `taskId` asks the reps engine for this task (REQUESTS.md «05.3»). Returns the rep id to
 * open on /today.
 */
export async function startDelegate(taskId: string): Promise<string> {
  const post = (kind: 'daily' | 'extra') => apiFetch<RepStart>('/api/reps', { method: 'POST', body: { type: 'delegate' satisfies RepType, kind, taskId } });
  let res: RepStart;
  try {
    res = await post('daily');
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'daily_exists')) throw err;
    res = await post('extra');
  }
  return 'rep' in res ? res.rep.id : res.repId;
}

export const loadSecondLook = (locale: Locale) => apiFetch<SecondLookState>(`/api/second-look?locale=${locale}`);

export const runSecondLook = (text: string, taskId: string | null, locale: Locale) =>
  apiFetch<SecondLookResult & { pointsAwarded: PointsAward[] }>('/api/second-look', { method: 'POST', body: { text, taskId, locale } });

export const errorCode = (err: unknown) => (err instanceof ApiError ? err.code : 'network');

const OWN = new Set(['too_short', 'too_long', 'text_too_short', 'text_too_long', 'pro_required', 'max_required', 'no_xray', 'not_found']);
const COMMON = new Set(['network', 'unauthorized', 'invalid_input', 'conflict', 'rate_limited', 'storage_unavailable', 'ai_unavailable', 'server_error', 'daily_exists', 'extra_limit', 'in_progress']);

/** Dictionary key for an API error code. */
export function errorKey(code: string): string {
  if (OWN.has(code)) return `playbook.errors.${code}`;
  if (COMMON.has(code)) return `common.errors.${code}`;
  return 'common.errors.server_error';
}

/** Splits an instruction into text and the [bracketed] parts the person fills in. */
export function slotsOf(text: string): { text: string; slot: boolean }[] {
  const out: { text: string; slot: boolean }[] = [];
  const re = /\[[^\[\]\n]{2,120}\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), slot: false });
    out.push({ text: m[0], slot: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), slot: false });
  return out;
}

/** Copies text to the clipboard; falls back to a hidden textarea where the async API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
