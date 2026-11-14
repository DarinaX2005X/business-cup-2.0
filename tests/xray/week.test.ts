import { describe, expect, it } from 'vitest';
import { applyWeekMap, typicalWeek } from '@/server/xray/week';
import { fixture } from '../domain/helpers';

const nurse = fixture('29-1141.00');
const duties = [
  { original: 'Assess 5–6 adult patients per shift', en: 'Assess adult patients each shift' },
  { original: 'Chart assessments in Epic', en: 'Chart assessments in the electronic health record' },
  { original: 'Administer IV medications', en: 'Administer medications' },
  { original: 'Organize the unit holiday party', en: 'Organize the unit holiday party' },
];
const sum = (s: { share: number }[]) => s.reduce((a, b) => a + b.share, 0);

describe('week.map post-processing', () => {
  it('keeps known tasks, maps duties back to their original wording, keeps unmapped duties', () => {
    const res = applyWeekMap(
      {
        tasks: [
          { taskId: '1841', share: 30, duties: [2] },
          { taskId: '20413', share: 25, duties: [3] },
          { taskId: '1849', share: 20, duties: [1] },
          { taskId: '1839', share: 15, duties: [] },
          { taskId: '1846', share: 2, duties: [] }, // unmatched and under 3%: dropped
          { taskId: '999999', share: 40, duties: [4] }, // unknown id: dropped
          { taskId: '1841', share: 10, duties: [1] }, // duplicate: dropped
        ],
        unmapped: [4],
      },
      nurse,
      duties,
    );
    expect(res.source).toBe('resume');
    expect(res.shares.map((s) => s.taskId)).toEqual(['1841', '20413', '1849', '1839']);
    expect(sum(res.shares)).toBe(100);
    expect(res.matches).toEqual({ '1841': ['Chart assessments in Epic'], '20413': ['Administer IV medications'], '1849': ['Assess 5–6 adult patients per shift'] });
    expect(res.unmappedDuties).toEqual(['Organize the unit holiday party']);
  });

  it('tops up to 4 tasks from the typical week with small shares', () => {
    const res = applyWeekMap({ tasks: [{ taskId: '1841', share: 60, duties: [2] }, { taskId: '20413', share: 40, duties: [3] }], unmapped: [] }, nurse, duties);
    expect(res.shares).toHaveLength(4);
    expect(sum(res.shares)).toBe(100);
    expect(res.shares[0].share).toBeGreaterThan(res.shares[3].share);
    expect(res.unmappedDuties).toEqual(['Assess 5–6 adult patients per shift', 'Organize the unit holiday party']);
  });

  it('caps at 14 tasks and never invents ids', () => {
    const tasks = nurse.tasks.slice(0, 20).map((t, i) => ({ taskId: t.id, share: 5 + i, duties: [1] }));
    const res = applyWeekMap({ tasks, unmapped: [] }, nurse, duties);
    expect(res.shares.length).toBe(14);
    const known = new Set(nurse.tasks.map((t) => t.id));
    expect(res.shares.every((s) => known.has(s.taskId) && s.share >= 1)).toBe(true);
    expect(sum(res.shares)).toBe(100);
  });

  it('nothing usable from the model → the typical week with every duty unmapped', () => {
    const res = applyWeekMap({ tasks: [{ taskId: 'nope', share: 50, duties: [1] }], unmapped: [] }, nurse, duties);
    expect(res.source).toBe('onet');
    expect(res.shares).toEqual(typicalWeek(nurse).shares);
    expect(res.unmappedDuties).toHaveLength(4);
  });
});
