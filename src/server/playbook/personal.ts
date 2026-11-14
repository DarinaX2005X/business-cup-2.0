import type { RepRecord } from '@/domain/reps';
import type { CheckItem, PracticeInstruction } from './types';

/**
 * What a person's own practice adds to a playbook card (pure, tested): the best scored Delegate
 * instruction for the task, and checklist lines from what slipped past them there before: Delegate
 * traps they did not catch (also when only the AI's own result pointed them out) and Spot the slip
 * mistakes they did not find.
 */

/** A practice instruction takes the starter's place from this score on (0..1). */
export const PRACTICE_BAR = 0.6;
/** Personal lines added under the starter checks, at most. */
export const PERSONAL_CHECKS_MAX = 3;
const TRAPS_MAX = 2;

export interface TaskPractice {
  best: PracticeInstruction | null;
  checks: CheckItem[];
  /** A finished Delegate rep exists on this task. */
  delegated: boolean;
}

const done = (r: RepRecord) => r.status === 'done' && !!r.result && Number.isFinite(r.result.score);
const newestFirst = (a: RepRecord, b: RepRecord) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Practice per task, for the given task ids only. Records of other people or occupations are ignored. */
export function practiceByTask(records: readonly RepRecord[], opts: { profileId: string; occupationCode: string; taskIds: Iterable<string> }): Map<string, TaskPractice> {
  const want = new Set(opts.taskIds);
  const out = new Map<string, TaskPractice>();
  const mine = records.filter((r) => r.profileId === opts.profileId && r.occupationCode === opts.occupationCode && want.has(r.taskId) && done(r)).sort(newestFirst);

  for (const id of want) {
    const reps = mine.filter((r) => r.taskId === id);
    const delegates = reps.filter((r) => r.type === 'delegate' && r.delegate);
    out.set(id, { best: bestInstruction(delegates), checks: personalChecks(reps), delegated: delegates.length > 0 });
  }
  return out;
}

/** Highest score wins; on a tie, the newer rep. Instructions that are empty are skipped. */
export function bestInstruction(delegates: readonly RepRecord[]): PracticeInstruction | null {
  let best: PracticeInstruction | null = null;
  for (const r of [...delegates].sort(newestFirst)) {
    const text = r.delegate?.instruction?.trim();
    const score = r.result?.score;
    if (!text || score === undefined || !Number.isFinite(score)) continue;
    if (!best || score > best.score) best = { text, score: Math.max(0, Math.min(1, score)), repId: r.id, day: r.day };
  }
  return best;
}

/** Missed traps first (newest first, at most two), then missed Spot the slip mistakes; duplicates dropped. */
export function personalChecks(reps: readonly RepRecord[]): CheckItem[] {
  const traps: CheckItem[] = [];
  const slips: CheckItem[] = [];
  const seen = new Set<string>();
  for (const r of [...reps].sort(newestFirst)) {
    if (r.type === 'delegate') {
      const caught = new Set(r.result?.trapsCaught ?? []);
      for (const trap of r.reveal?.traps ?? r.delegate?.traps ?? []) {
        if (caught.has(trap.id)) continue;
        const text = trap.description?.trim();
        if (!text || seen.has(key(text))) continue;
        seen.add(key(text));
        traps.push({ id: `trap:${r.id}:${trap.id}`, text, origin: 'trap', day: r.day });
      }
    } else if (r.type === 'slip') {
      const errors = r.reveal?.errors ?? r.slip?.errors ?? [];
      const found = r.result?.errorsFound;
      // without per-mistake results only a rep where nothing was found says which ones slipped past
      if (!found && r.result?.found !== 0) continue;
      errors.forEach((e, i) => {
        if (found?.[i]) return;
        const text = e.explanation?.trim();
        if (!text || seen.has(key(text))) return;
        seen.add(key(text));
        slips.push({ id: `slip:${r.id}:${i}`, text, origin: 'slip', slipType: e.type, day: r.day });
      });
    }
  }
  return [...traps.slice(0, TRAPS_MAX), ...slips].slice(0, PERSONAL_CHECKS_MAX);
}
