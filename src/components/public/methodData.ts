import { CATEGORY_THRESHOLDS, DEFAULT_WEEK_TASKS, HIGH_EXPOSURE, PRACTICE_GAIN, PRACTICE_SCALE, THEORY_WEIGHT } from '@/domain/constants';
import { observedScore } from '@/domain/evidence';
import { defaultShares, taskWeight } from '@/domain/shares';
import { computeXray, practiceScore } from '@/domain/xray';
import type { OccTask, OccupationBundle } from '@/domain/types';
import { getBundle } from './data';
import { shortLabel } from './text';

export const NURSE = '29-1141.00';
export const ELECTRICIAN = '47-2111.00';

export interface WorkedExample {
  occupation: string;
  slug: string;
  task: OccTask;
  short: string;
  theory: number;
  observed: number;
  exposure: number;
  reason: 'why_does' | 'why_speeds_close' | 'why_speeds' | 'why_human' | 'why_physical';
}

function worked(bundle: OccupationBundle, task: OccTask): WorkedExample {
  const e = task.evidence;
  const obs = observedScore(e.observed, e.aeiAutomation);
  const t = CATEGORY_THRESHOLDS;
  let reason: WorkedExample['reason'];
  if (e.category === 'ai_does') reason = 'why_does';
  else if (e.category === 'human_edge') reason = e.physical && !e.observed ? 'why_physical' : 'why_human';
  else reason = e.observed && (e.aeiAutomation ?? 0) >= t.aiDoesAutomation ? 'why_speeds_close' : 'why_speeds';
  return { occupation: bundle.title, slug: bundle.slug, task, short: shortLabel(task.text), theory: e.theory, observed: obs, exposure: e.exposure, reason };
}

/**
 * Two tasks that show the rule at work: the most exposed observed nursing task (mostly automated,
 * still «speeds it up») and an electrician's task AI already does. Chosen from the data, so a new
 * build can change them.
 */
export async function workedExamples(): Promise<WorkedExample[]> {
  const out: WorkedExample[] = [];
  const nurse = await getBundle(NURSE);
  if (nurse) {
    const observed = nurse.tasks.filter((t) => t.evidence.observed).sort((a, b) => b.evidence.exposure - a.evidence.exposure);
    const pick = observed[0] ?? [...nurse.tasks].sort((a, b) => b.evidence.exposure - a.evidence.exposure)[0];
    if (pick) out.push(worked(nurse, pick));
  }
  const elec = await getBundle(ELECTRICIAN);
  if (elec) {
    const does = elec.tasks.filter((t) => t.evidence.category === 'ai_does').sort((a, b) => b.evidence.exposure - a.evidence.exposure);
    const pick = does[0] ?? [...elec.tasks].sort((a, b) => b.evidence.exposure - a.evidence.exposure)[0];
    if (pick) out.push(worked(elec, pick));
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
    return { id: t.id, text: t.text, short: shortLabel(t.text), importance: t.importance, frequency: t.frequency, weight: taskWeight(t), share: s.share };
  });
  const { result, breakdown } = computeXray(bundle, shares);
  const practice = { n: 20, avgScore: 0.8 };
  const ps = practiceScore(result.baseScore, practice);
  return { bundle, taskCount: bundle.tasks.length, top, result, breakdown, practice, ps };
}

export const CONSTANTS = {
  THEORY_WEIGHT,
  HIGH_EXPOSURE,
  PRACTICE_GAIN,
  PRACTICE_SCALE,
  DEFAULT_WEEK_TASKS,
  ...CATEGORY_THRESHOLDS,
};
