import { after } from 'next/server';
import { z } from 'zod';
import type { Category, Locale, OccupationBundle } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { cacheGet, cacheSet, lock } from '@/server/ai/cache';
import { callModel, isAiError } from '@/server/ai/client';
import { xrayTipsPrompt, xrayTipsSchema, type XrayTips } from '@/server/ai/prompts/xray-tips';
import { getStore } from '@/server/store';
import { loadBundle } from './data';

/**
 * Tips, short labels and task translations per occupation and language (02.1.4).
 * GET /api/xray/tips and /api/occupations/:code/texts read the stored record; when it is missing the
 * first request starts `xray.tips` in `after()` under a lock and answers `{ pending: true }`.
 * A failed generation leaves a marker for 10 minutes so polling clients hear `{ unavailable: true }`.
 */

const TIPS_VERSION = 1;
const tipsKey = (code: string, locale: Locale) => `tips:v${TIPS_VERSION}:${code}:${locale}`;
const failKey = (code: string, locale: Locale) => `tips-fail:v${TIPS_VERSION}:${code}:${locale}`;
const TIPS_TTL_SEC = 90 * 24 * 3600;
const FAIL_TTL_SEC = 600;
const LOCK_TTL_SEC = 120;
const MAX_TIP = 200; // the prompt asks for 160; a little over is kept, a runaway answer is dropped
const MAX_SHORT_WORDS = 6;

export type TipKind = 'hand' | 'edge';

export interface TaskTip {
  short: string;
  tip: string;
  kind: TipKind;
  /** Only for tasks without data (no_data): the "why it is yours" note next to the hand-off tip. */
  edgeTip: string | null;
}

const recordSchema = z.object({
  createdAt: z.string(),
  tasks: z.record(
    z.string(),
    z.object({
      short: z.string().nullable(),
      text: z.string().nullable(),
      tip: z.string().nullable(),
      kind: z.enum(['hand', 'edge']),
      edgeTip: z.string().nullable(),
    }),
  ),
});
export type TipsRecord = z.infer<typeof recordSchema>;

export type TipsStatus =
  | { status: 'ready'; record: TipsRecord }
  | { status: 'pending' }
  | { status: 'unavailable' };

export function kindOf(category: Category): TipKind {
  return category === 'human_edge' ? 'edge' : 'hand';
}

export async function readTips(code: string, locale: Locale): Promise<TipsRecord | null> {
  return cacheGet(tipsKey(code, locale), recordSchema);
}

/**
 * Current state of the tips for this occupation and language. When missing, schedules generation after
 * the response (must be called inside a request: route handler or server function).
 */
export async function ensureTips(bundle: OccupationBundle, locale: Locale, actor?: Actor): Promise<TipsStatus> {
  const record = await readTips(bundle.code, locale);
  if (record) return { status: 'ready', record };
  const store = getStore();
  if (await store.get(failKey(bundle.code, locale))) return { status: 'unavailable' };
  const held = await lock(`tips:${bundle.code}:${locale}`, LOCK_TTL_SEC);
  if (held) {
    after(async () => {
      try {
        await generateTips(bundle, locale, actor);
      } catch (err) {
        const code = isAiError(err) ? err.code : 'error';
        console.error(`[tips] ${bundle.code} ${locale} failed: ${code}${isAiError(err) ? '' : ` ${(err as Error).message}`}`);
        await store.set(failKey(bundle.code, locale), { code, at: new Date().toISOString() }, { ttlSec: FAIL_TTL_SEC }).catch(() => undefined);
      } finally {
        await held.release().catch(() => undefined);
      }
    });
  }
  return { status: 'pending' };
}

/** One model call per occupation and language; `actor` puts it under the visitor's IP/profile daily limit. */
export async function generateTips(bundle: OccupationBundle, locale: Locale, actor?: Actor): Promise<TipsRecord> {
  const { data } = await callModel({
    op: 'xray.tips',
    schema: xrayTipsSchema,
    system: xrayTipsPrompt.system(locale),
    user: xrayTipsPrompt.user({
      occupation: bundle.title,
      tasks: bundle.tasks.map((t) => ({
        id: t.id,
        text: t.text,
        category: t.evidence.category,
        observed: t.evidence.observed,
        automation: t.evidence.aeiAutomation,
        physical: t.evidence.physical,
      })),
    }),
    locale,
    maxTokens: locale === 'en' ? 6000 : 12000,
    temperature: 0.3,
    reasoning: 'off',
    actor,
  });
  const record = applyTips(data, bundle, locale);
  await cacheSet(tipsKey(bundle.code, locale), record, TIPS_TTL_SEC);
  return record;
}

const cleanText = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Pure: keeps known task ids, picks the tip by the data category, drops over-long or empty fields. */
export function applyTips(data: XrayTips, bundle: Pick<OccupationBundle, 'tasks'>, locale: Locale): TipsRecord {
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const tasks: TipsRecord['tasks'] = {};
  for (const item of data.tasks) {
    const task = byId.get(String(item.taskId).trim());
    if (!task || tasks[task.id]) continue;
    const category = task.evidence.category;
    const kind = kindOf(category);
    const hand = cleanText(item.tipHand);
    const edge = cleanText(item.tipEdge);
    const ok = (s: string) => s.length > 0 && s.length <= MAX_TIP;
    const tip = kind === 'edge' ? (ok(edge) ? edge : null) : ok(hand) ? hand : null;
    const short = cleanText(item.short).replace(/[.。]+$/, '');
    const text = locale === 'en' ? null : cleanText(item.text) || null;
    tasks[task.id] = {
      short: short && short.split(' ').length <= MAX_SHORT_WORDS && short.length <= 60 ? short : null,
      text,
      tip,
      kind,
      edgeTip: category === 'no_data' && ok(edge) ? edge : null,
    };
  }
  return { createdAt: new Date().toISOString(), tasks };
}

/** The tips response: tasks that have a tip, with their label (label falls back to the heuristic). */
export function tipsResponse(record: TipsRecord, bundle: Pick<OccupationBundle, 'tasks'>): Record<string, TaskTip> {
  const out: Record<string, TaskTip> = {};
  for (const t of bundle.tasks) {
    const r = record.tasks[t.id];
    if (!r?.tip) continue;
    out[t.id] = { short: r.short ?? heuristicShort(t.text), tip: r.tip, kind: r.kind, edgeTip: r.edgeTip };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Task texts

const STOP_AT = new Set(['and', 'or', 'to', 'for', 'using', 'including', 'such', 'by', 'with', 'in', 'on', 'at', 'from', 'that', 'which', 'as']);

/**
 * Short label without the model: the task text up to its first clause boundary, at most 5 words
 * ("Record patients' medical information and vital signs." → "Record patients' medical information").
 */
export function heuristicShort(text: string): string {
  const words = text.replace(/[.;:]+\s*$/, '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const bare = w.toLowerCase().replace(/[^a-z']/g, '');
    if (out.length >= 2 && STOP_AT.has(bare)) break;
    const endsClause = /[,;:]$/.test(w);
    out.push(w.replace(/[,;:]+$/, ''));
    if (out.length >= 5) break;
    if (endsClause && out.length >= 3) break;
  }
  return out.join(' ');
}

export interface TaskTexts {
  tasks: Record<string, { text: string; short: string }>;
  /** true when labels (and, for ru/kk, translations) come from the generated record. */
  ready: boolean;
}

function textsFrom(bundle: Pick<OccupationBundle, 'tasks'>, record: TipsRecord | null): TaskTexts {
  const tasks: TaskTexts['tasks'] = {};
  for (const t of bundle.tasks) {
    const r = record?.tasks[t.id];
    tasks[t.id] = { text: r?.text ?? t.text, short: r?.short ?? heuristicShort(t.text) };
  }
  return { tasks, ready: record !== null };
}

/**
 * Task texts and short labels for an occupation in a language; English text and heuristic labels until
 * the tips record exists. For stage 03 (rep task captions) and the week screens. Null for an unknown code.
 * Reads only: it does not start generation (use ensureTips inside a request for that).
 */
export async function getTaskTexts(code: string, locale: Locale): Promise<TaskTexts | null> {
  const bundle = await loadBundle(code);
  if (!bundle) return null;
  return textsFrom(bundle, await readTips(code, locale));
}

/** Same as getTaskTexts for a loaded bundle, and starts tip generation when the record is missing. */
export async function taskTextsEnsuring(bundle: OccupationBundle, locale: Locale, actor?: Actor): Promise<TaskTexts> {
  const status = await ensureTips(bundle, locale, actor);
  return textsFrom(bundle, status.status === 'ready' ? status.record : null);
}
