import { after } from 'next/server';
import { z } from 'zod';
import type { Locale, OccupationBundle } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { cacheGet, cacheSet, lock } from '@/server/ai/cache';
import { callModel, isAiError } from '@/server/ai/client';
import { playbookStarterPrompt, playbookStarterSchema, type PlaybookStarterAnswer, type StarterTaskInput } from '@/server/ai/prompts/playbook-starter';
import { getStore } from '@/server/store';
import type { StarterState } from './types';

/**
 * Starter instructions per occupation and language (05.3.1): `playbook.starter` writes, for every task
 * of the occupation that AI does or speeds up, an instruction and 3–5 checks. The record is shared by
 * everyone with this occupation and language. A request that finds tasks missing starts the generation
 * in `after()` under a lock and answers `pending`; the client polls. A failed run leaves a short marker
 * so polling ends in `unavailable`, and the next request after it tries again for the missing tasks.
 */

const VERSION = 1;
const recordKey = (code: string, locale: Locale) => `playbook:starter:v${VERSION}:${code}:${locale}`;
const failKey = (code: string, locale: Locale) => `playbook:starter-fail:v${VERSION}:${code}:${locale}`;
const RECORD_TTL_SEC = 90 * 24 * 3600;
const FAIL_TTL_SEC = 120;
const LOCK_TTL_SEC = 150;

export const STARTER_CATEGORIES = new Set(['ai_does', 'ai_speeds']);

const INSTRUCTION_CHARS = { min: 160, max: 1800 } as const;
const CHECK_CHARS = { min: 12, max: 180 } as const;
export const CHECKS = { min: 3, max: 5 } as const;

const entrySchema = z.object({ instruction: z.string(), checks: z.array(z.string()) });
const recordSchema = z.object({ createdAt: z.string(), tasks: z.record(z.string(), entrySchema) });
export type StarterEntry = z.infer<typeof entrySchema>;
export type StarterRecord = z.infer<typeof recordSchema>;

/** Tasks a starter is written for: the occupation's tasks that AI already does or speeds up. */
export function starterTasks(bundle: Pick<OccupationBundle, 'tasks'>): StarterTaskInput[] {
  return bundle.tasks.filter((t) => STARTER_CATEGORIES.has(t.evidence.category)).map((t) => ({ id: t.id, text: t.text, category: t.evidence.category }));
}

export async function readStarter(code: string, locale: Locale): Promise<StarterRecord | null> {
  return cacheGet(recordKey(code, locale), recordSchema);
}

/**
 * The starter record and its state for the tasks a screen needs. Must run inside a request (it may
 * schedule the generation with `after()`).
 */
export async function ensureStarter(
  bundle: OccupationBundle,
  locale: Locale,
  wanted: readonly string[],
  actor?: Actor,
): Promise<{ state: StarterState; record: StarterRecord | null }> {
  const record = await readStarter(bundle.code, locale);
  const own = new Set(starterTasks(bundle).map((t) => t.id));
  const missing = wanted.filter((id) => own.has(id) && !record?.tasks[id]);
  if (!missing.length) return { state: 'ready', record };
  const store = getStore();
  if (await store.get(failKey(bundle.code, locale))) return { state: 'unavailable', record };
  const held = await lock(`playbook-starter:${bundle.code}:${locale}`, LOCK_TTL_SEC);
  if (held) {
    after(async () => {
      try {
        await generateStarter(bundle, locale, actor);
      } catch (err) {
        const code = isAiError(err) ? err.code : 'error';
        console.error(`[playbook] starter ${bundle.code} ${locale} failed: ${code}${isAiError(err) ? '' : ` ${(err as Error).message}`}`);
        await store.set(failKey(bundle.code, locale), { code, at: new Date().toISOString() }, { ttlSec: FAIL_TTL_SEC }).catch(() => undefined);
      } finally {
        await held.release().catch(() => undefined);
      }
    });
  }
  return { state: 'pending', record };
}

/**
 * Tasks per call. The model writes ~85 tokens/s and one task is ~350 tokens in English (about twice
 * that in Russian or Kazakh), so small parallel chunks keep the whole job near 15–20 s.
 */
const CHUNK: Record<Locale, number> = { en: 4, ru: 3, kk: 3 };
const TOKENS_PER_TASK: Record<Locale, number> = { en: 700, ru: 1100, kk: 1200 };

/**
 * Writes the starter for the occupation's tasks that the record does not have yet, in parallel chunks.
 * Chunks that succeed are kept even when another fails (the failure is rethrown after saving), so a
 * retry only asks for what is still missing.
 */
export async function generateStarter(bundle: OccupationBundle, locale: Locale, actor?: Actor): Promise<StarterRecord> {
  const before = await readStarter(bundle.code, locale);
  const todo = starterTasks(bundle).filter((t) => !before?.tasks[t.id]);
  const chunks: StarterTaskInput[][] = [];
  if (todo.length) {
    const size = Math.ceil(todo.length / Math.ceil(todo.length / CHUNK[locale]));
    for (let i = 0; i < todo.length; i += size) chunks.push(todo.slice(i, i + size));
  }
  const settled = await Promise.allSettled(
    chunks.map((tasks, i) =>
      callModel({
        op: 'playbook.starter',
        schema: playbookStarterSchema,
        system: playbookStarterPrompt.system(locale),
        user: playbookStarterPrompt.user({ occupation: bundle.title, tasks }),
        locale,
        maxTokens: Math.min(8000, tasks.length * TOKENS_PER_TASK[locale] + 400),
        temperature: 0.4,
        actor: i === 0 ? actor : undefined,
      }),
    ),
  );
  const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value.data.tasks : []));
  const fresh = applyStarter({ tasks: answers }, bundle);
  // re-read just before writing: another instance may have finished other chunks meanwhile
  const latest = await readStarter(bundle.code, locale);
  const record: StarterRecord = { createdAt: latest?.createdAt ?? new Date().toISOString(), tasks: { ...(latest?.tasks ?? {}), ...fresh } };
  if (Object.keys(fresh).length) await cacheSet(recordKey(bundle.code, locale), record, RECORD_TTL_SEC);
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  const stillMissing = todo.filter((t) => !record.tasks[t.id]);
  if (stillMissing.length) throw new Error(`starter incomplete: ${stillMissing.length} task(s) without a usable answer`);
  return record;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Instruction text: markdown emphasis and headings removed, line breaks kept (short lists stay readable). */
export function cleanInstruction(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .split('\n')
    .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[*+]\s+/, '- ').replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Pure: keeps known starter task ids with a usable instruction and at least three distinct checks. */
export function applyStarter(answer: PlaybookStarterAnswer, bundle: Pick<OccupationBundle, 'tasks'>): Record<string, StarterEntry> {
  const own = new Set(starterTasks(bundle).map((t) => t.id));
  const out: Record<string, StarterEntry> = {};
  for (const item of answer.tasks) {
    const id = String(item.taskId).trim();
    if (!own.has(id) || out[id]) continue;
    const instruction = cleanInstruction(item.instruction);
    if (instruction.length < INSTRUCTION_CHARS.min || instruction.length > INSTRUCTION_CHARS.max) continue;
    const seen = new Set<string>();
    const checks: string[] = [];
    for (const raw of item.checks) {
      const c = oneLine(raw).replace(/^(?:[-*•]\s+|\d{1,2}[.)]\s+)/, '');
      const key = c.toLowerCase();
      if (c.length < CHECK_CHARS.min || c.length > CHECK_CHARS.max || seen.has(key)) continue;
      seen.add(key);
      checks.push(c);
      if (checks.length >= CHECKS.max) break;
    }
    if (checks.length < CHECKS.min) continue;
    out[id] = { instruction, checks };
  }
  return out;
}
