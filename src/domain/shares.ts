import { DEFAULT_SHARE_MAX, DEFAULT_SHARE_MIN, DEFAULT_WEEK_TASKS, FREQ_DEFAULT_CATEGORY, FREQ_PER_YEAR, MAX_WEEK_TASKS } from './constants';
import type { OccTask, OccupationBundle, WeekShare } from './types';

type BundleTasks = Pick<OccupationBundle, 'tasks'>;

/**
 * Integer apportionment that sums exactly to `total` with every item >= `min`.
 * Largest remainder; ties go to the earlier item, so the result is deterministic.
 */
export function apportion(weights: number[], total: number, min = 1): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n * min > total) throw new Error(`cannot give ${n} items at least ${min} of ${total}`);
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const raw = clean.map((w) => (sum > 0 ? (w / sum) * total : total / n));
  const out = raw.map((r) => Math.max(min, Math.floor(r)));
  const frac = raw.map((r, i) => ({ i, frac: r - Math.floor(r) }));
  let diff = total - out.reduce((a, b) => a + b, 0);
  // Short: add to the largest remainders. Over (minimums were raised): take from the smallest remainders above min.
  const up = [...frac].sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; diff > 0; k = (k + 1) % n, diff--) out[up[k].i] += 1;
  const down = [...frac].sort((a, b) => a.frac - b.frac || b.i - a.i);
  while (diff < 0) {
    const pick = down.find((x) => out[x.i] > min)!; // exists because n × min <= total
    out[pick.i] -= 1;
    diff++;
  }
  return out;
}

/** O*NET frequency category mean (1..7) → approximate occurrences per year, linear between the anchors. */
export function occurrencesPerYear(category: number): number {
  const c = Math.min(7, Math.max(1, category));
  const lo = Math.floor(c);
  const hi = Math.min(7, lo + 1);
  return FREQ_PER_YEAR[lo] + (FREQ_PER_YEAR[hi] - FREQ_PER_YEAR[lo]) * (c - lo);
}

/**
 * Weight of a task in the typical week: importance × relevance/100 × sqrt(occurrences per year).
 * Relevance is left out when missing; a rated task without frequency counts as "more than weekly";
 * an occupation published without ratings gets equal weights.
 */
export function taskWeight(task: Pick<OccTask, 'importance' | 'frequency'> & { relevance?: number | null }): number {
  if (task.importance === null) return 1;
  const relevance = task.relevance == null ? 1 : Math.max(task.relevance, 1) / 100;
  const freq = Math.sqrt(occurrencesPerYear(task.frequency ?? FREQ_DEFAULT_CATEGORY));
  return task.importance * relevance * freq;
}

/**
 * Integer shares proportional to weights within [min, max] that sum to `total` (water-filling, then largest
 * remainder without crossing the bounds). The cap is lifted when it cannot be met (fewer than total/max items).
 */
export function boundedApportion(weights: number[], total: number, min: number, max: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const cap = n * max < total ? total : max;
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const fixed: (number | null)[] = new Array(n).fill(null);
  let real: number[] = [];
  for (let iter = 0; iter <= n; iter++) {
    const free = w.map((_, i) => i).filter((i) => fixed[i] === null);
    const left = total - fixed.reduce<number>((a, v) => a + (v ?? 0), 0);
    const sum = free.reduce((a, i) => a + w[i], 0);
    real = w.map((x, i) => fixed[i] ?? (sum > 0 ? (x / sum) * left : left / free.length));
    let changed = false;
    for (const i of free) {
      if (real[i] > cap) (fixed[i] = cap), (changed = true);
      else if (real[i] < min) (fixed[i] = min), (changed = true);
    }
    if (!changed) break;
  }
  const out = real.map((r) => Math.min(cap, Math.max(min, Math.floor(r))));
  let diff = total - out.reduce((a, b) => a + b, 0);
  const order = real.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let guard = 0; diff > 0 && guard < n * total; guard++) {
    const k = order[guard % n].i;
    if (out[k] < cap) (out[k] += 1), diff--;
  }
  for (let guard = 0; diff < 0 && guard < n * total; guard++) {
    const k = order[n - 1 - (guard % n)].i;
    if (out[k] > min) (out[k] -= 1), diff++;
  }
  return out;
}

/**
 * Typical week from O*NET ratings: the 10 tasks with the largest weight, integer shares summing to 100,
 * each between 3% and 25% so the week has real variance without one task swallowing it.
 */
export function defaultShares(bundle: BundleTasks): WeekShare[] {
  const ranked = bundle.tasks
    .map((t, i) => ({ t, i, w: taskWeight(t) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, DEFAULT_WEEK_TASKS);
  const shares = boundedApportion(
    ranked.map((r) => r.w),
    100,
    DEFAULT_SHARE_MIN,
    DEFAULT_SHARE_MAX,
  );
  return ranked.map((r, k) => ({ taskId: r.t.id, share: shares[k] }));
}

/**
 * Clean shares coming from a model, a client or storage: unknown task IDs, duplicates, non-finite and
 * non-positive values are dropped; at most 14 tasks (largest kept); rescaled to integers summing to 100,
 * each at least 1. Returns [] when nothing valid is left; callers fall back to defaultShares.
 */
export function normalizeShares(shares: readonly WeekShare[], bundle: BundleTasks): WeekShare[] {
  const known = new Set(bundle.tasks.map((t) => t.id));
  const seen = new Set<string>();
  const valid: WeekShare[] = [];
  for (const s of shares) {
    if (!s || typeof s.taskId !== 'string' || !known.has(s.taskId) || seen.has(s.taskId)) continue;
    if (typeof s.share !== 'number' || !Number.isFinite(s.share) || s.share <= 0) continue;
    seen.add(s.taskId);
    valid.push({ taskId: s.taskId, share: s.share });
  }
  const kept = valid
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.share - a.s.share || a.i - b.i)
    .slice(0, MAX_WEEK_TASKS)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  const ints = apportion(kept.map((s) => s.share), 100);
  return kept.map((s, k) => ({ taskId: s.taskId, share: ints[k] }));
}

/**
 * Set one task's share and rescale the others proportionally: every share stays >= 1 and the total is
 * exactly 100. The target is clamped to [1, 100 − (n − 1)]. Unknown taskId returns the input unchanged.
 */
export function redistributeShares(shares: readonly WeekShare[], taskId: string, newShare: number): WeekShare[] {
  const idx = shares.findIndex((s) => s.taskId === taskId);
  if (idx < 0) return shares.map((s) => ({ ...s }));
  const n = shares.length;
  if (n === 1) return [{ taskId, share: 100 }];
  const target = Math.min(100 - (n - 1), Math.max(1, Math.round(Number.isFinite(newShare) ? newShare : 1)));
  const others = shares.filter((_, i) => i !== idx);
  const rest = apportion(
    others.map((s) => s.share),
    100 - target,
  );
  let k = 0;
  return shares.map((s, i) => (i === idx ? { taskId, share: target } : { taskId: s.taskId, share: rest[k++] }));
}
