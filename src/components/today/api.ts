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
