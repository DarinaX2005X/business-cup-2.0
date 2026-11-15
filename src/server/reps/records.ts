import { randomBytes } from 'node:crypto';
import type { RepRecord, RepView } from '@/domain/reps';
import type { Locale } from '@/domain/types';
import { getStore } from '@/server/store';
import { getTaskTexts, heuristicShort, loadBundle } from '@/server/xray';

/**
 * Rep storage: `rep:<id>` holds a RepRecord (versioned; answers compare-and-set on the version so two
 * tabs cannot grade one rep twice); `repjob:<id>` marks a generation in progress or failed (expires).
 */

export const repKey = (id: string) => `rep:${id}`;
export const repJobKey = (id: string) => `repjob:${id}`;
export const JOB_TTL_SEC = 600;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const REP_ID_RE = /^[0-9A-Za-z]{14}$/;
export const isRepId = (v: unknown): v is string => typeof v === 'string' && REP_ID_RE.test(v);

export function newRepId(): string {
  let out = '';
  while (out.length < 14) {
    for (const b of randomBytes(28)) if (b < 248 && out.length < 14) out += BASE62[b % 62];
  }
  return out;
}

export async function readRep(id: string): Promise<{ rep: RepRecord; version: number } | null> {
  if (!isRepId(id)) return null;
  const hit = await getStore().get<RepRecord>(repKey(id));
  return hit ? { rep: hit.value, version: hit.version } : null;
}

export interface RepJob {
  status: 'generating' | 'failed';
  profileId: string;
  at: string;
  reason?: string;
}

export async function readJob(id: string): Promise<RepJob | null> {
  const hit = await getStore().get<RepJob>(repJobKey(id));
  return hit?.value ?? null;
}

export async function writeJob(id: string, job: RepJob): Promise<void> {
  await getStore().set(repJobKey(id), job, { ttlSec: JOB_TTL_SEC });
}

export async function clearJob(id: string): Promise<void> {
  await getStore().del(repJobKey(id));
}

export const MAX_EDGE_REPLIES = 6;

/** Task caption in the UI language: translated text and short label when the tips record has them. */
export async function taskCaption(code: string, taskId: string, locale: Locale): Promise<{ text: string; short: string }> {
  const [texts, bundle] = await Promise.all([getTaskTexts(code, locale).catch(() => null), loadBundle(code).catch(() => null)]);
  const task = bundle?.tasks.find((x) => x.id === taskId);
  const t = texts?.tasks[taskId];
  // the bundle's own short label (data build) is the English fallback; the tips record wins for ru/kk
  const short = (locale === 'en' ? task?.short : undefined) || t?.short || task?.short || (task ? heuristicShort(task.text) : '');
  if (t) return { text: t.text, short };
  return task ? { text: task.text, short } : { text: '', short: '' };
}

/**
 * What the client may see. Before completion: no mistakes, traps, hidden persona or rubric keywords.
 * After completion: the result and the reveal.
 */
export async function toView(rep: RepRecord, uiLocale: Locale): Promise<RepView> {
  const caption = await taskCaption(rep.occupationCode, rep.taskId, uiLocale);
  const done = rep.status === 'done';
  const view: RepView = {
    id: rep.id,
    type: rep.type,
    kind: rep.kind,
    status: rep.status,
    source: rep.source,
    title: rep.title,
    brief: rep.brief,
    taskId: rep.taskId,
    taskText: caption.text,
    taskShort: caption.short,
    occupationCode: rep.occupationCode,
    locale: rep.locale,
    notes: rep.notes ?? [],
    difficulty: rep.difficulty,
    day: rep.day,
    ...(rep.docType ? { docType: rep.docType } : {}),
  };
  if (rep.slip) view.slip = { document: rep.slip.document, errorCount: rep.slip.errors.length };
  if (rep.slipHints?.length) view.slipHints = rep.slipHints.map(({ start, end }) => ({ start, end }));
  if (rep.delegate) {
    const d = rep.delegate;
    view.delegate = {
      scenario: d.scenario,
      inputs: d.inputs,
      goal: d.goal,
      criteria: d.criteria.map(({ id, text }) => ({ id, text })),
      ...(d.instruction !== undefined ? { instruction: d.instruction } : {}),
      ...(d.run !== undefined ? { run: d.run } : {}),
      ...(d.review ? { review: d.review } : {}),
    };
  }
  if (rep.edge) {
    const e = rep.edge;
    view.edge = {
      scenario: e.scenario,
      personaPublic: e.personaPublic,
      goal: e.goal,
      criteria: e.criteria.map(({ id, text }) => ({ id, text })),
      turns: e.turns,
      repliesLeft: done ? 0 : Math.max(0, MAX_EDGE_REPLIES - e.turns.filter((t) => t.role === 'user').length),
    };
  }
  if (done) {
    if (rep.result) view.result = rep.result;
    view.reveal = rep.reveal ?? {};
  }
  return view;
}
