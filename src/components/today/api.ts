'use client';

import type { AiOrMeRoundFull, RepView } from '@/domain/reps';
import type { PointsAward, Profile, RepType } from '@/domain/types';
import { ApiError, apiFetch } from '@/lib/client/api';

/*
 * Client side of the reps API (stage 03.1). Shapes follow the routes in src/app/api/reps/** and the
 * notes in REQUESTS.md «03.1»; nothing here invents data.
 */

export type Streak = Profile['streak'];
export type RepKind = RepView['kind'];

export interface ChoiceTask {
  type: RepType;
  taskId: string;
  taskText: string;
  taskShort: string;
  minutes: number;
}

/** GET /api/reps/today for Pro (and trialing). */
export interface TodayPro {
  day: string;
  daily: RepView | null;
  extras: RepView[];
  extrasLeft: number;
  choices: RepType[];
  nextKind: 'daily' | 'extra';
  choiceTasks: Record<RepType, ChoiceTask>;
  streak: Streak;
  aiOrMe: AiOrMeRoundFull;
  tomorrow: ChoiceTask;
  /** While a rep is being written. */
  status?: 'generating';
  repId?: string;
  pendingKind?: RepKind;
}

/** The 402 body of GET /api/reps/today for Free. */
export interface TodayFree {
  trial: { status: 'available' | 'in_progress' | 'used'; repId?: string; rep?: RepView; generating?: boolean };
  aiOrMe: AiOrMeRoundFull | null;
  hasXray: boolean;
  tomorrow: ChoiceTask | null;
  streak: Streak;
}

export type Hub =
  | { kind: 'pro'; data: TodayPro }
  | { kind: 'free'; data: TodayFree }
  | { kind: 'noMap' }
  | { kind: 'error'; code: string };

export type RepOrPending = { rep: RepView } | { status: 'generating'; repId: string };

export interface AnswerResult {
  rep: RepView;
  pointsAwarded: PointsAward[];
  streak: Streak;
}

export async function loadToday(): Promise<Hub> {
  try {
    return { kind: 'pro', data: await apiFetch<TodayPro>('/api/reps/today') };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 402 && err.body) {
        const body = err.body as TodayFree;
        return body.hasXray ? { kind: 'free', data: body } : { kind: 'noMap' };
      }
      if (err.code === 'no_xray') return { kind: 'noMap' };
      return { kind: 'error', code: err.code };
    }
    return { kind: 'error', code: 'network' };
  }
}

export const getRep = (id: string) => apiFetch<RepOrPending>(`/api/reps/${encodeURIComponent(id)}`);

export const createRep = (type: RepType, kind: 'daily' | 'extra') => apiFetch<RepOrPending>('/api/reps', { method: 'POST', body: { type, kind } });

export const startTrial = () => apiFetch<RepOrPending>('/api/reps/trial', { method: 'POST' });

export type AnswerBody =
  | { ranges: [number, number][] }
  | { step: 'instruction'; instruction: string }
  | { step: 'review'; ranges: [number, number][]; fix: string }
  | { message: string }
  | { finish: true };

export const answerRep = (id: string, body: AnswerBody) =>
  apiFetch<AnswerResult>(`/api/reps/${encodeURIComponent(id)}/answer`, { method: 'POST', body });

export const submitAiOrMe = (roundId: string, answers: ('ai' | 'human' | null)[]) =>
  apiFetch<{ correct: boolean[]; right: number; total: number; pointsAwarded: PointsAward[] }>('/api/ai-or-me', {
    method: 'POST',
    body: { roundId, answers },
  });

export const logWork = (taskId: string, minutes: number) =>
  apiFetch<{ entry: { id: string; taskId: string; minutes: number; day: string }; minutesToday: number; pointsAwarded: PointsAward[] }>('/api/work-log', {
    method: 'POST',
    body: { taskId, minutes },
  });

/*
 * Fields the engine is adding (REQUESTS «03.1 repair»). Read when present, so the screen works before and
 * after they land. Shapes this screen expects are listed in REQUESTS «03.2».
 */
type Loose = Record<string, unknown> | undefined | null;
const isRange = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number');

/** Spot the slip: highlights graded as too broad (`result.tooBroad: [start, end][]`). */
export function tooBroadOf(result: unknown): [number, number][] {
  const r = result as Loose;
  const direct = r?.tooBroad ?? r?.tooBroadRanges;
  if (Array.isArray(direct)) return direct.filter(isRange);
  const list = r?.highlights;
  if (!Array.isArray(list)) return [];
  return list
    .filter((h: Loose) => h && (h.tooBroad === true || h.status === 'too_broad' || (Array.isArray(h.flags) && h.flags.includes('too_broad'))))
    .map((h: Loose) => (isRange(h?.range) ? h.range : [Number(h?.start), Number(h?.end)]))
    .filter(isRange);
}

/** Delegate: traps the AI flagged by itself (`reveal.traps[].caughtByAi` or `result.trapsCaughtByAi`). */
export function caughtByAiOf(rep: { result?: unknown; reveal?: unknown }): Set<string> {
  const out = new Set<string>();
  const traps = (rep.reveal as Loose)?.traps;
  if (Array.isArray(traps)) for (const tr of traps as Loose[]) if (tr?.caughtByAi === true && typeof tr.id === 'string') out.add(tr.id);
  const ids = (rep.result as Loose)?.trapsCaughtByAi;
  if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') out.add(id);
  return out;
}

/** Delegate: the model instruction (`reveal.exemplar`, a string or `{ text, covers? }`). */
export function exemplarOf(reveal: unknown): { text: string; covers: string[] | null } | null {
  const e = (reveal as Loose)?.exemplar as unknown;
  if (typeof e === 'string' && e.trim()) return { text: e.trim(), covers: null };
  const o = e as Loose;
  if (o && typeof o.text === 'string' && o.text.trim()) return { text: o.text.trim(), covers: Array.isArray(o.covers) ? (o.covers as unknown[]).filter((x): x is string => typeof x === 'string') : null };
  return null;
}

/** Delegate: what the person sent at the review step (`delegate.review`). */
export function reviewOf(delegate: unknown): { ranges: [number, number][]; fix: string } | null {
  const r = (delegate as Loose)?.review as Loose;
  if (!r) return null;
  return { ranges: Array.isArray(r.ranges) ? r.ranges.filter(isRange) : [], fix: typeof r.fix === 'string' ? r.fix : '' };
}

/** Human edge: a reply that could do harm (`result.harm`, one or a list of `{ quote, why }`). */
export function harmOf(result: unknown): { quote: string; why: string }[] {
  const h = (result as Loose)?.harm as unknown;
  const list = Array.isArray(h) ? h : h ? [h] : [];
  return (list as Loose[]).filter((x) => x && typeof x.quote === 'string' && typeof x.why === 'string').map((x) => ({ quote: String(x!.quote), why: String(x!.why) }));
}

/** A rep or a pending generation from a 409 body (daily_exists carries the existing rep's state). */
export function repFromConflict(err: unknown): RepOrPending | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { rep?: RepView; status?: string; repId?: string } | null;
  if (body?.rep) return { rep: body.rep };
  if (body?.status === 'generating' && body.repId) return { status: 'generating', repId: body.repId };
  return null;
}

export const errorCode = (err: unknown) => (err instanceof ApiError ? err.code : 'network');

/** Codes the reps API answers with; their texts live in today.errors (REQUESTS.md asks MAIN to add them to common.errors). */
const TODAY_CODES = new Set([
  'pro_required',
  'no_xray',
  'daily_exists',
  'extra_limit',
  'in_progress',
  'trial_used',
  'generation_failed',
  'already_done',
  'already_run',
  'not_run',
  'no_replies_left',
  'nothing_to_grade',
  'already_played',
  'stale_round',
  'work_log_limit',
]);
const COMMON_CODES = new Set(['network', 'unauthorized', 'invalid_input', 'not_found', 'conflict', 'rate_limited', 'storage_unavailable', 'ai_unavailable', 'server_error']);

export function errorKey(code: string): string {
  if (TODAY_CODES.has(code)) return `today.errors.${code}`;
  if (COMMON_CODES.has(code)) return `common.errors.${code}`;
  return 'common.errors.server_error';
}

/** Polls GET /api/reps/:id every 2 s until the rep is written (or fails). */
export function pollRep(id: string, onDone: (rep: RepView) => void, onFail: (code: string) => void): () => void {
  let stop = false;
  let timer = 0;
  const started = Date.now();
  const tick = async () => {
    try {
      const r = await getRep(id);
      if (stop) return;
      if ('rep' in r) return onDone(r.rep);
    } catch (err) {
      if (stop) return;
      const code = errorCode(err);
      // a dropped connection is retried; anything the server said is final
      if (code !== 'network') return onFail(code);
    }
    if (Date.now() - started > 150_000) return onFail('generation_failed');
    timer = window.setTimeout(tick, 2000);
  };
  timer = window.setTimeout(tick, 1200);
  return () => {
    stop = true;
    window.clearTimeout(timer);
  };
}
