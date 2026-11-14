import { defaultShares, normalizeShares } from '@/domain/shares';
import type { Locale, OccupationBundle, WeekShare } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { callModel } from '@/server/ai/client';
import { weekMapPrompt, weekMapSchema, type WeekMap } from '@/server/ai/prompts/week-map';

/**
 * POST /api/xray/week (02.1.3). Without duties: the typical week from O*NET ratings. With duties:
 * `week.map` proposes shares; code keeps only known tasks, drops unmatched tasks under 3%,
 * normalises to integers summing to 100 with 4..14 tasks and returns the duties no task covers.
 */

export const MIN_WEEK_TASKS = 4;
const MIN_UNMATCHED_SHARE = 3;
/** Share (before normalisation) given to typical-week tasks added when the model left fewer than 4. */
const FILL_SHARE = 3;

export interface Duty {
  original: string;
  en: string;
}

export interface WeekProposal {
  shares: WeekShare[];
  /** taskId → original wording of the duties it covers */
  matches: Record<string, string[]>;
  /** original wording of duties no kept task covers */
  unmappedDuties: string[];
  source: 'resume' | 'onet';
}

export function typicalWeek(bundle: Pick<OccupationBundle, 'tasks'>): WeekProposal {
  return { shares: defaultShares(bundle), matches: {}, unmappedDuties: [], source: 'onet' };
}

export async function proposeWeek(input: { bundle: OccupationBundle; duties: Duty[]; locale: Locale; actor?: Actor }): Promise<WeekProposal> {
  const { bundle, duties, locale, actor } = input;
  if (!duties.length) return typicalWeek(bundle);
  const { data } = await callModel({
    op: 'week.map',
    schema: weekMapSchema,
    system: weekMapPrompt.system,
    user: weekMapPrompt.user({ duties: duties.map((d) => d.en), tasks: bundle.tasks.map((t) => ({ id: t.id, text: t.text })) }),
    locale,
    cacheKey: bundle.code,
    maxTokens: 1500,
    temperature: 0.2,
    actor,
  });
  return applyWeekMap(data, bundle, duties);
}

/** Pure post-processing of the model answer (tested without the model). */
export function applyWeekMap(map: WeekMap, bundle: Pick<OccupationBundle, 'tasks'>, duties: Duty[]): WeekProposal {
  const known = new Set(bundle.tasks.map((t) => t.id));
  const validDuty = (n: number) => Number.isInteger(n) && n >= 1 && n <= duties.length;

  const proposed: { taskId: string; share: number; duties: number[] }[] = [];
  for (const t of map.tasks) {
    const taskId = String(t.taskId).trim();
    if (!known.has(taskId) || proposed.some((p) => p.taskId === taskId)) continue;
    if (!Number.isFinite(t.share) || t.share <= 0) continue;
    const ds = [...new Set(t.duties.filter(validDuty))];
    if (!ds.length && t.share < MIN_UNMATCHED_SHARE) continue;
    proposed.push({ taskId, share: t.share, duties: ds });
  }

  let shares = normalizeShares(proposed.map((p) => ({ taskId: p.taskId, share: p.share })), bundle);
  if (!shares.length) {
    // Nothing usable from the model: the typical week, with every duty left for the person to attach.
    return { ...typicalWeek(bundle), unmappedDuties: duties.map((d) => d.original) };
  }
  if (shares.length < MIN_WEEK_TASKS) {
    const have = new Set(shares.map((s) => s.taskId));
    const fill = defaultShares(bundle).filter((s) => !have.has(s.taskId)).slice(0, MIN_WEEK_TASKS - shares.length);
    // Keep the model's proportions; the added tasks get a small slice each.
    const scaled = shares.map((s) => ({ taskId: s.taskId, share: s.share }));
    shares = normalizeShares([...scaled, ...fill.map((f) => ({ taskId: f.taskId, share: FILL_SHARE }))], bundle);
  }

  const kept = new Set(shares.map((s) => s.taskId));
  const matches: Record<string, string[]> = {};
  const covered = new Set<number>();
  for (const p of proposed) {
    if (!kept.has(p.taskId) || !p.duties.length) continue;
    matches[p.taskId] = p.duties.map((n) => duties[n - 1].original);
    p.duties.forEach((n) => covered.add(n));
  }
  const unmappedDuties = duties.filter((_, i) => !covered.has(i + 1)).map((d) => d.original);
  return { shares, matches, unmappedDuties, source: 'resume' };
}
