import { describe, expect, it } from 'vitest';
import { defaultShares } from '@/domain/shares';
import type { Category, WeekShare } from '@/domain/types';
import { computeXray, practiceScore } from '@/domain/xray';
import { bundle, fixture, task } from './helpers';

const total = (r: Record<Category, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('computeXray', () => {
  const b = bundle([task('1', 'ai_does'), task('2', 'ai_speeds'), task('3', 'human_edge'), task('4', 'no_data', { importance: 4.5 })]);
  const shares: WeekShare[] = [
    { taskId: '1', share: 40 },
    { taskId: '2', share: 30 },
    { taskId: '3', share: 20 },
    { taskId: '4', share: 10 },
  ];

  it('splits 40 hours and 100% across categories', () => {
    const { result } = computeXray(b, shares);
    expect(result.percent).toEqual({ ai_does: 40, ai_speeds: 30, human_edge: 20, no_data: 10 });
    expect(result.hours).toEqual({ ai_does: 16, ai_speeds: 12, human_edge: 8, no_data: 4 });
    expect(total(result.hours)).toBeCloseTo(40);
    expect(result.observedShare).toBe(0.4);
  });

  it('applies the formulas: weekExposure, baseScore, payAtStake, handToAi, humanEdge, hoursFreed', () => {
    const { result, breakdown } = computeXray(b, shares);
    // exposures: ai_does 0.5 × 1 + 0.5 × (0.5 + 0.5 × 0.8) = 0.95, ai_speeds 0.25, human_edge 0, no_data 0
    expect(result.weekExposure).toBeCloseTo(0.4 * 0.95 + 0.3 * 0.25, 4);
    // the score uses the category weights of pay at stake: 100 × (1 − 0.55) = 45
    expect(result.baseScore).toBe(45);
    expect(result.score).toBe(result.baseScore);
    expect(result.salary).toEqual({ annual: 60000, source: 'bls_median' });
    // pay at stake uses the category weights of hoursFreed: (40 × 1 + 30 × 0.5) / 100 = 0.55
    expect(result.payAtStake).toBe(33000);
    expect(breakdown.pay).toEqual({ annual: 60000, shareAtStake: 0.55, shareHighExposure: 0.55, weights: { ai_does: 1, ai_speeds: 0.5 } });
    expect(result.handToAi).toEqual(['1', '2']);
    expect(result.humanEdge).toEqual(['3', '4']);
    expect(result.hoursFreed).toBe(16 + 12 * 0.5);
    expect(breakdown.perTask.reduce((a, t) => a + t.contribution, 0)).toBeCloseTo(result.weekExposure, 3);
  });

  it('uses the person’s salary over the BLS median, and null without either', () => {
    expect(computeXray(b, shares, { salary: 100000 }).result.salary).toEqual({ annual: 100000, source: 'user' });
    const noWage = computeXray(bundle(b.tasks, null), shares).result;
    expect(noWage.salary).toEqual({ annual: null, source: 'none' });
    expect(noWage.payAtStake).toBeNull();
  });

  it('one task at 100% and all tasks in one category', () => {
    const one = computeXray(b, [{ taskId: '3', share: 100 }]).result;
    expect(one.percent.human_edge).toBe(100);
    expect(one.baseScore).toBe(100);
    expect(one.handToAi).toEqual([]);
    const allDoes = bundle(['a', 'b', 'c'].map((id) => task(id, 'ai_does')));
    const r = computeXray(allDoes, defaultShares(allDoes)).result;
    expect(r.percent.ai_does).toBe(100);
    expect(r.humanEdge).toEqual([]);
    expect(r.handToAi).toHaveLength(3);
  });

  it('all no_data: score 100 from data, human edge only from important tasks', () => {
    const nd = bundle([task('a', 'no_data', { importance: 4.2 }), task('b', 'no_data', { importance: 3 })]);
    const r = computeXray(nd, [{ taskId: 'a', share: 50 }, { taskId: 'b', share: 50 }]).result;
    expect(r.percent.no_data).toBe(100);
    expect(r.weekExposure).toBe(0);
    expect(r.humanEdge).toEqual(['a']);
    expect(r.observedShare).toBe(0);
  });

  it('invalid shares fall back to the default week', () => {
    const r = computeXray(b, [{ taskId: 'missing', share: 100 }]).result;
    expect(r.shares).toEqual(defaultShares(b));
  });

  it('score grows with verified practice and stays put without it', () => {
    const base = computeXray(b, shares).result.score;
    expect(computeXray(b, shares, { practice: { n: 0, avgScore: 1 } }).result.score).toBe(base);
    expect(computeXray(b, shares, { practice: { n: 10, avgScore: 0 } }).result.score).toBe(base);
    const s10 = computeXray(b, shares, { practice: { n: 10, avgScore: 0.8 } }).result.score;
    const s40 = computeXray(b, shares, { practice: { n: 40, avgScore: 0.8 } }).result.score;
    expect(s10).toBeGreaterThan(base);
    expect(s40).toBeGreaterThan(s10);
    expect(practiceScore(50, { n: 1e6, avgScore: 1 }).score).toBe(Math.round(50 + 50 * 0.45));
  });

  it('recomputes a 14-task week in under 1 ms', () => {
    const acc = fixture('13-2011.00');
    const week = acc.tasks.slice(0, 14).map((t) => ({ taskId: t.id, share: 7 }));
    for (let i = 0; i < 200; i++) computeXray(acc, week); // warm-up
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) computeXray(acc, week);
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(1);
  });
});

describe('pay at stake agrees with the categories shown', () => {
  it.each(['29-1141.00', '29-2061.00', '13-2011.00', '47-2111.00', '43-4051.00', '25-2022.00', '23-2011.00', '43-5032.00'])('%s', (code) => {
    const b = fixture(code);
    const { result } = computeXray(b, defaultShares(b));
    const expected = Math.round(b.wage.medianAnnual! * (result.percent.ai_does + 0.5 * result.percent.ai_speeds) / 100);
    expect(result.payAtStake).toBe(expected);
    // a week with only human-edge tasks has nothing at stake
    const human = defaultShares(b).filter((s) => b.tasks.find((t) => t.id === s.taskId)!.evidence.category === 'human_edge');
    if (human.length) expect(computeXray(b, human).result.payAtStake).toBe(0);
  });
});

describe('two similar occupations give different, explainable numbers', () => {
  it('Registered Nurses vs Licensed Practical Nurses', () => {
    const rn = fixture('29-1141.00');
    const lpn = fixture('29-2061.00');
    const a = computeXray(rn, defaultShares(rn)).result;
    const b = computeXray(lpn, defaultShares(lpn)).result;
    expect(a.score).not.toBe(b.score);
    expect(a.payAtStake).not.toBe(b.payAtStake);
    // The difference is explained by data: RN weeks hold more record-keeping and coordination (E2 labels),
    // LPN weeks more hands-on care (physical, unobserved). Wages come from different BLS rows.
    expect(a.percent.human_edge).toBeLessThan(b.percent.human_edge);
    expect(a.weekExposure).toBeGreaterThan(b.weekExposure);
    expect(rn.wage.soc).toBe('29-1141');
    expect(lpn.wage.soc).toBe('29-2061');
    expect(rn.wage.medianAnnual).toBeGreaterThan(lpn.wage.medianAnnual!);
    console.log(
      `RN  score ${a.score}, human ${a.percent.human_edge}%, exposure ${a.weekExposure}, pay at stake $${a.payAtStake}\n` +
        `LPN score ${b.score}, human ${b.percent.human_edge}%, exposure ${b.weekExposure}, pay at stake $${b.payAtStake}`,
    );
  });
});
