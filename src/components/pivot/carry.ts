import { defaultShares, normalizeShares, taskWeight } from '@/domain/shares';
import type { OccupationBundle, WeekShare } from '@/domain/types';

/**
 * «Map my week as this job» (05.2.1): the person's own week moved onto a neighbouring occupation.
 * Pure, so the server page and the tests use the same rule.
 *
 * Each task of the person's week goes to the target task that shares the most O*NET Detailed Work
 * Activities with it (Jaccard over DWA ids, ties to the target task O*NET rates more important, then the
 * earlier one). A task with no shared activity cannot carry over; its hours go to the target's typical
 * week (`defaultShares`) in proportion. The result is normalised like any week (integers summing to 100,
 * at most 14 tasks), so `computeXray` reads it as an ordinary week.
 */

type Tasks = Pick<OccupationBundle, 'tasks'>;

export interface CarryPair {
  /** Task of the person's current week. */
  from: string;
  /** Task of the target occupation it moves to. */
  to: string;
  /** Share of the week (0..100) that moved. */
  share: number;
}

export interface CarriedWeek {
  /** The person's week in the target occupation: integers summing to 100. */
  shares: WeekShare[];
  pairs: CarryPair[];
  /** Share of the current week (0..100) that found a matching task in the target. */
  carried: number;
  /** Target tasks in `shares` that received none of the carried hours: work that would be new. */
  fresh: string[];
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared === 0 ? 0 : shared / (a.size + b.size - shared);
}

export function carryWeek(source: Tasks, week: readonly WeekShare[], target: Tasks): CarriedWeek {
  const srcById = new Map(source.tasks.map((t) => [t.id, t]));
  const targets = target.tasks.map((t, i) => ({ id: t.id, i, w: taskWeight(t), dwa: new Set(t.dwaIds) }));
  const acc = new Map<string, number>();
  const pairs: CarryPair[] = [];
  let leftover = 0;
  let total = 0;

  for (const s of week) {
    if (!(s.share > 0)) continue;
    total += s.share;
    const task = srcById.get(s.taskId);
    const dwa = new Set(task?.dwaIds ?? []);
    let best: { id: string; j: number; w: number; i: number } | null = null;
    if (dwa.size) {
      for (const t of targets) {
        const j = jaccard(dwa, t.dwa);
        if (j === 0) continue;
        if (!best || j > best.j || (j === best.j && (t.w > best.w || (t.w === best.w && t.i < best.i)))) best = { id: t.id, j, w: t.w, i: t.i };
      }
    }
    if (!best) {
      leftover += s.share;
      continue;
    }
    acc.set(best.id, (acc.get(best.id) ?? 0) + s.share);
    pairs.push({ from: s.taskId, to: best.id, share: s.share });
  }

  if (total <= 0) return { shares: defaultShares(target), pairs: [], carried: 0, fresh: defaultShares(target).map((s) => s.taskId) };

  if (leftover > 0) {
    for (const d of defaultShares(target)) acc.set(d.taskId, (acc.get(d.taskId) ?? 0) + (leftover * d.share) / 100);
  }
  const shares = normalizeShares(
    [...acc].map(([taskId, share]) => ({ taskId, share })),
    target,
  );
  const received = new Set(pairs.map((p) => p.to));
  return {
    shares,
    pairs,
    carried: Math.round(((total - leftover) / total) * 1000) / 10,
    fresh: shares.map((s) => s.taskId).filter((id) => !received.has(id)),
  };
}
