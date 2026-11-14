import { HIGH_EXPOSURE, PRACTICE_GAIN, PRACTICE_SCALE, WEEK_HOURS } from './constants';
import { defaultShares, normalizeShares } from './shares';
import type { Category, OccTask, OccupationBundle, WeekShare, XrayBreakdown, XrayComputed } from './types';

export interface XrayOptions {
  /** Annual salary the person entered (USD); null/undefined uses the BLS median of the occupation. */
  salary?: number | null;
  /** Verified practice: number of completed reps and their mean score 0..1. */
  practice?: { n: number; avgScore: number };
}

type XrayBundle = Pick<OccupationBundle, 'code' | 'tasks' | 'wage' | 'dataVersion'>;

const emptyByCategory = (): Record<Category, number> => ({ ai_does: 0, ai_speeds: 0, human_edge: 0, no_data: 0 });

/** Practice factor F = (1 − e^(−n/20)) × avgScore and the resulting score. */
export function practiceScore(baseScore: number, practice: { n: number; avgScore: number }) {
  const n = Math.max(0, Math.floor(practice.n));
  const avg = Math.min(1, Math.max(0, practice.avgScore));
  const F = (1 - Math.exp(-n / PRACTICE_SCALE)) * avg;
  const score = Math.round(baseScore + (100 - baseScore) * PRACTICE_GAIN * F);
  return { n, avg, F, score };
}

/**
 * Week map of one person: hours by category, observed share, pay at stake, irreplaceability score,
 * hand-to-AI and human-edge tasks. Pure and synchronous (the client recomputes on every slider move).
 * Shares are normalised first (empty or invalid input falls back to defaultShares); the list used is
 * returned in result.shares.
 */
export function computeXray(
  bundle: XrayBundle,
  inputShares: readonly WeekShare[],
  options: XrayOptions = {},
): { result: XrayComputed; breakdown: XrayBreakdown } {
  const normalized = normalizeShares(inputShares, bundle);
  const shares = normalized.length ? normalized : defaultShares(bundle);
  const byId = new Map<string, OccTask>(bundle.tasks.map((t) => [t.id, t]));

  const percent = emptyByCategory();
  let observed = 0;
  let weekExposure = 0;
  let highExposure = 0;
  const perTask: XrayBreakdown['perTask'] = [];
  for (const s of shares) {
    const task = byId.get(s.taskId)!;
    const e = task.evidence;
    percent[e.category] += s.share;
    if (e.evidenceLevel === 'observed') observed += s.share;
    if (e.exposure >= HIGH_EXPOSURE) highExposure += s.share;
    const contribution = (s.share * e.exposure) / 100;
    weekExposure += contribution;
    perTask.push({ taskId: s.taskId, share: s.share, hours: hoursOf(s.share), exposure: e.exposure, contribution: round(contribution, 4) });
  }
  const hours = emptyByCategory();
  for (const c of Object.keys(percent) as Category[]) hours[c] = hoursOf(percent[c]);

  const annual = options.salary != null && options.salary > 0 ? options.salary : bundle.wage.medianAnnual;
  const salarySource = options.salary != null && options.salary > 0 ? 'user' : annual != null ? 'bls_median' : 'none';
  const shareHighExposure = highExposure / 100;
  const payAtStake = annual != null ? Math.round(annual * shareHighExposure) : null;

  weekExposure = round(weekExposure, 4);
  const baseScore = Math.round(100 * (1 - weekExposure));
  const practice = options.practice ?? { n: 0, avgScore: 0 };
  const ps = practiceScore(baseScore, practice);

  const pick = (cats: Category[], extra?: (t: OccTask) => boolean) => {
    const chosen: string[] = [];
    for (const cat of cats) {
      const pool = shares
        .map((s, i) => ({ s, i, t: byId.get(s.taskId)! }))
        .filter((x) => x.t.evidence.category === cat && (!extra || extra(x.t)))
        .sort((a, b) => b.s.share - a.s.share || a.i - b.i);
      for (const x of pool) if (chosen.length < 3) chosen.push(x.s.taskId);
    }
    return chosen;
  };
  const handToAi = pick(['ai_does', 'ai_speeds']);
  const humanEdge = [
    ...pick(['human_edge']),
    ...pick(['no_data'], (t) => (t.importance ?? 0) >= 4),
  ].slice(0, 3);

  const shareOf = new Map(shares.map((s) => [s.taskId, s.share]));
  let hoursFreed = 0;
  for (const id of handToAi) {
    const h = hoursOf(shareOf.get(id)!);
    hoursFreed += byId.get(id)!.evidence.category === 'ai_does' ? h : h * 0.5;
  }

  const result: XrayComputed = {
    occupationCode: bundle.code,
    shares,
    hours,
    percent,
    observedShare: observed / 100,
    salary: { annual: annual ?? null, source: salarySource },
    payAtStake,
    weekExposure,
    baseScore,
    score: ps.score,
    practice: { n: ps.n, avgScore: ps.avg },
    handToAi,
    humanEdge,
    hoursFreed: round(hoursFreed, 1),
    dataVersion: bundle.dataVersion,
  };
  const breakdown: XrayBreakdown = {
    perTask,
    scoreFormula: { base: baseScore, n: ps.n, avg: ps.avg, F: round(ps.F, 4), score: ps.score },
    pay: { annual: annual ?? null, shareHighExposure },
  };
  return { result, breakdown };
}

function hoursOf(share: number): number {
  return round((share * WEEK_HOURS) / 100, 1);
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
