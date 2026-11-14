import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as K from '@/domain/constants';

import { defaultShares, occurrencesPerYear, taskWeight } from '@/domain/shares';
import { computeXray, practiceScore } from '@/domain/xray';
import type { Category, OccTask, OccupationBundle, TaskEvidence } from '@/domain/types';
import { getBundle, getMeta, getOccupations } from './data';
import { taskShort } from './text';

export const NURSE = '29-1141.00';

/**
 * Constants as the build reports them: meta.json first (written by the data pipeline from the same
 * domain constants), the domain module for anything the build does not list.
 */
export function constants() {
  const fromMeta = getMeta().constants as Record<string, number>;
  const pick = <T extends number>(key: string, fallback: T) => (typeof fromMeta[key] === 'number' ? fromMeta[key] : fallback);
  const th = K.CATEGORY_THRESHOLDS as Record<string, number>;
  return {
    THEORY_WEIGHT: pick('THEORY_WEIGHT', K.THEORY_WEIGHT),
    WORK_GATE: pick('WORK_GATE', K.WORK_GATE),
    aiDoesAutomation: pick('aiDoesAutomation', th.aiDoesAutomation),
    aiSpeedsTheory: pick('aiSpeedsTheory', th.aiSpeedsTheory ?? 0.25),
    physicalMaxTheory: pick('physicalMaxTheory', th.physicalMaxTheory ?? 0.5),
    PRACTICE_GAIN: pick('PRACTICE_GAIN', K.PRACTICE_GAIN),
    PRACTICE_SCALE: pick('PRACTICE_SCALE', K.PRACTICE_SCALE),
    DEFAULT_WEEK_TASKS: pick('DEFAULT_WEEK_TASKS', K.DEFAULT_WEEK_TASKS),
    DEFAULT_SHARE_MIN: pick('DEFAULT_SHARE_MIN', K.DEFAULT_SHARE_MIN),
    DEFAULT_SHARE_MAX: pick('DEFAULT_SHARE_MAX', K.DEFAULT_SHARE_MAX),
    AT_STAKE_DOES: K.AT_STAKE_WEIGHTS.ai_does,
    AT_STAKE_SPEEDS: K.AT_STAKE_WEIGHTS.ai_speeds,
    FREQ_PER_YEAR: K.FREQ_PER_YEAR,
  };
}

/** Which rule of categorize() decided a task, in the order the rules are tried. */
export type PathStep = 'observed_does' | 'observed_speeds' | 'physical' | 'rated_speeds' | 'usage_speeds' | 'low_human' | 'no_data';
export const PATH_ORDER: PathStep[] = ['observed_does', 'observed_speeds', 'physical', 'rated_speeds', 'usage_speeds', 'low_human', 'no_data'];
export const PATH_CATEGORY: Record<PathStep, Category> = {
  observed_does: 'ai_does',
  observed_speeds: 'ai_speeds',
  physical: 'human_edge',
  rated_speeds: 'ai_speeds',
  usage_speeds: 'ai_speeds',
  low_human: 'human_edge',
  no_data: 'no_data',
};

type PathInput = Pick<TaskEvidence, 'theorySource' | 'theory' | 'observed' | 'everObserved' | 'penetration' | 'aeiAutomation' | 'physical'>;

/** Mirrors src/domain/evidence.ts categorize(), but says which rule fired. */
export function categoryPath(e: PathInput): PathStep {
  const c = constants();
  const usage = e.everObserved || (e.penetration ?? 0) > 0;
  if (e.theorySource === null && !e.observed) return 'no_data';
  if (e.observed) return (e.aeiAutomation ?? 0.5) >= c.aiDoesAutomation ? 'observed_does' : 'observed_speeds';
  if (e.physical === true && !usage && e.theory <= c.physicalMaxTheory) return 'physical';
  if (e.theory >= c.aiSpeedsTheory) return 'rated_speeds';
  if (usage) return 'usage_speeds';
  return 'low_human';
}

let countsPromise: Promise<Record<PathStep, number> & { total: number }> | null = null;

/** Number of tasks that leave the rule path at each step, over every bundle of this build. */
export function pathCounts() {
  countsPromise ??= (async () => {
    const out = Object.fromEntries(PATH_ORDER.map((p) => [p, 0])) as Record<PathStep, number>;
    let total = 0;
    const dir = path.join(process.cwd(), 'public', 'data', 'occ');
    for (const o of await getOccupations()) {
      const b = JSON.parse(await readFile(path.join(dir, `${o.code}.json`), 'utf8')) as OccupationBundle;
      for (const t of b.tasks) {
        out[categoryPath(t.evidence)]++;
        total++;
      }
    }
    return { ...out, total };
  })().catch((err) => {
    countsPromise = null;
    throw err;
  });
  return countsPromise;
}

export interface WorkedExample {
  task: OccTask;
  short: string;
  step: PathStep;
  share: number;
}

/**
 * Three tasks from a typical nursing week that leave the rule path at different steps. Chosen from the
 * data, so a new build can change them.
 */
export async function workedExamples(): Promise<WorkedExample[]> {
  const nurse = await getBundle(NURSE);
  if (!nurse) return [];
  const byId = new Map(nurse.tasks.map((t) => [t.id, t]));
  const week = defaultShares(nurse).map((s) => ({ task: byId.get(s.taskId)!, share: s.share }));
  const rest = nurse.tasks.filter((t) => !week.some((w) => w.task.id === t.id)).map((task) => ({ task, share: 0 }));
  const pool = [...week, ...rest];
  const wanted: PathStep[][] = [['observed_does', 'observed_speeds'], ['physical', 'low_human'], ['rated_speeds', 'usage_speeds']];
  const out: WorkedExample[] = [];
  for (const steps of wanted) {
    const hit = pool.find((r) => steps.includes(categoryPath(r.task.evidence)) && !out.some((o) => o.task.id === r.task.id));
    if (hit) out.push({ task: hit.task, short: taskShort(hit.task), step: categoryPath(hit.task.evidence), share: hit.share });
  }
  return out;
}

export async function nurseWeek() {
  const bundle = await getBundle(NURSE);
  if (!bundle) return null;
  const shares = defaultShares(bundle);
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const top = shares.slice(0, 4).map((s) => {
    const t = byId.get(s.taskId)!;
    return {
      id: t.id,
      text: t.text,
      short: taskShort(t),
      importance: t.importance,
      relevance: t.relevance,
      perYear: t.frequency != null ? occurrencesPerYear(t.frequency) : null,
      weight: taskWeight(t),
      share: s.share,
    };
  });
  const { result, breakdown } = computeXray(bundle, shares);
  // Same sum the week map's inspector shows: Σ share × weight over the tasks of the week.
  const pointsOff = breakdown.perTask.reduce((sum, p) => sum + p.scorePoints, 0);
  const practice = { n: 20, avgScore: 0.8 };
  const ps = practiceScore(result.baseScore, practice);
  const observed = bundle.tasks.find((t) => t.evidence.observed) ?? null;
  return { bundle, taskCount: bundle.tasks.length, top, result, pointsOff, practice, ps, observed };
}

