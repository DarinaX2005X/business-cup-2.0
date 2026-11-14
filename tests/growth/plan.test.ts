import { describe, expect, it } from 'vitest';
import type { Category, PlanProgress } from '@/domain/types';
import type { PlanGenerateOutput } from '@/server/ai/prompts/plan-generate';
import {
  checkPlan,
  currentWeekOf,
  keptWeeks,
  mergeRefresh,
  planInputsKey,
  planSummary,
  planView,
  type PlanCheckContext,
} from '@/server/growth/plan';
import type { GrowthPlan } from '@/server/growth/types';

const tasks = new Map<string, { label: string; category: Category }>([
  ['1841', { label: 'Charting', category: 'ai_speeds' }],
  ['1842', { label: 'Discharge teaching', category: 'human_edge' }],
  ['1843', { label: 'Care plans', category: 'ai_does' }],
]);
const skills = new Map([
  ['2.B.1.e', 'Teaching others'],
  ['tech:Epic Systems', 'Epic Systems'],
]);
const ctx = (over: Partial<PlanCheckContext> = {}): PlanCheckContext => ({ planId: 'Ab12Cd34', fromWeek: 1, tasks, skills, ...over });

type Item = PlanGenerateOutput['weeks'][number]['items'][number];
const rep = (taskId: string, repType: 'slip' | 'delegate' | 'edge', n: number): Item => ({ kind: 'rep', taskId, repType, skillId: null, text: `Do ${n === 1 ? 'one' : 'two'} ${repType} reps on {task} this week, round ${n}` });

function goodWeeks(from = 1): PlanGenerateOutput['weeks'] {
  const out: PlanGenerateOutput['weeks'] = [];
  for (let w = from; w <= 12; w++) {
    const items: Item[] = [
      rep(w <= 4 ? '1843' : w <= 8 ? '1841' : '1842', w <= 4 ? 'delegate' : w <= 8 ? 'slip' : 'edge', w),
      { kind: 'work', taskId: '1843', repType: null, skillId: null, text: `Use your Playbook instruction for {task} on Tuesday, week ${w}` },
      { kind: 'skill', taskId: '1842', repType: null, skillId: '2.B.1.e', text: `Practise {skill} during {task} with one patient, week ${w}` },
    ];
    if (w === 12) items.push({ kind: 'review', taskId: null, repType: null, skillId: null, text: 'Build your Review kit and book a talk with your manager' });
    out.push({ week: w, focus: w === 1 ? 'Hand {task} to AI and check it' : `Week ${w} focus words`, focusTaskId: w === 1 ? '1843' : null, items });
  }
  return out;
}

describe('checkPlan', () => {
  it('fills task and skill names in, from the person\'s data, and gives every item a stable id', () => {
    const res = checkPlan({ weeks: goodWeeks() }, ctx());
    expect(res.fatal).toEqual([]);
    expect(res.soft).toEqual([]);
    expect(res.weeks).toHaveLength(12);
    const w1 = res.weeks[0];
    expect(w1.focus).toBe('Hand Care plans to AI and check it');
    expect(w1.items[0]).toMatchObject({ id: 'Ab12Cd34-1-1', kind: 'rep', repType: 'delegate', taskId: '1843', taskLabel: 'Care plans', category: 'ai_does' });
    expect(w1.items[0].text).toBe('Do one delegate reps on Care plans this week, round 1');
    expect(w1.items[2]).toMatchObject({ skillId: '2.B.1.e', skillName: 'Teaching others', taskLabel: 'Discharge teaching' });
    expect(res.weeks.map((w) => w.month)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
  });

  it('drops actions on tasks outside the week or skills outside the lists, and fails a week left with too few', () => {
    const weeks = goodWeeks();
    weeks[2].items[0] = { ...weeks[2].items[0], taskId: '9999' };
    weeks[3].items[2] = { ...weeks[3].items[2], skillId: '2.C.4.d' };
    const res = checkPlan({ weeks }, ctx());
    expect(res.fatal).toEqual(expect.arrayContaining([expect.stringMatching(/^Week 3 has 2 usable actions/), expect.stringMatching(/^Week 4 has 2 usable actions/)]));
    expect(res.soft.join('\n')).toMatch(/taskId 9999 is not a task of their week/);
    expect(res.soft.join('\n')).toMatch(/skillId 2\.C\.4\.d is not in the skill lists/);
  });

  it('refuses invented figures, stray placeholders and repeats', () => {
    const weeks = goodWeeks();
    weeks[0].items.push({ kind: 'work', taskId: '1841', repType: null, skillId: null, text: 'Save 40% of {task} time with AI' });
    weeks[1].items.push({ kind: 'review', taskId: null, repType: null, skillId: null, text: 'Tell {manager} about your progress' });
    weeks[4].items.push({ ...weeks[4].items[1] });
    const res = checkPlan({ weeks }, ctx());
    expect(res.fatal).toEqual([]);
    expect(res.weeks[0].items).toHaveLength(3);
    expect(res.weeks[1].items).toHaveLength(3);
    expect(res.weeks[4].items).toHaveLength(3);
    expect(res.soft).toHaveLength(3);
  });

  it('asks for a wrong number of weeks again', () => {
    const res = checkPlan({ weeks: goodWeeks().slice(0, 11) }, ctx());
    expect(res.fatal[0]).toMatch(/exactly 12 weeks/);
  });

  it('notices a plan without one of the rep types or a Review kit milestone (worth a retry, still usable)', () => {
    const weeks = goodWeeks().map((w) => ({ ...w, items: w.items.filter((i) => i.kind !== 'review') }));
    for (const w of weeks) w.items[0] = { ...w.items[0], repType: 'slip' };
    const res = checkPlan({ weeks }, ctx());
    expect(res.fatal).toEqual([]);
    expect(res.soft).toEqual(expect.arrayContaining(['Use the delegate rep type at least once.', 'Use the edge rep type at least once.', 'Add a Review kit milestone in week 11 or 12.']));
  });

  it('a refresh writes and numbers only the weeks from where it starts', () => {
    const res = checkPlan({ weeks: goodWeeks(5) }, ctx({ fromWeek: 5 }));
    expect(res.fatal).toEqual([]);
    expect(res.weeks.map((w) => w.n)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(res.weeks[0].items[0].id).toBe('Ab12Cd34-5-1');
  });
});

function storedPlan(): GrowthPlan {
  const { weeks } = checkPlan({ weeks: goodWeeks() }, ctx());
  return { id: 'Ab12Cd34', xrayId: 'X'.repeat(12), profileId: 'p', occupationCode: '29-1141.00', jobTitle: 'Charge Nurse', inputsKey: 'k1', weeks, createdAt: '2026-11-01T09:00:00.000Z' };
}

describe('calendar, refresh and views', () => {
  it('counts weeks from the start day and stops at 12', () => {
    expect(currentWeekOf('2026-11-01', '2026-11-01')).toBe(1);
    expect(currentWeekOf('2026-11-01', '2026-11-07')).toBe(1);
    expect(currentWeekOf('2026-11-01', '2026-11-08')).toBe(2);
    expect(currentWeekOf('2026-11-01', '2027-06-01')).toBe(12);
    expect(currentWeekOf('2026-11-10', '2026-11-01')).toBe(1);
  });

  it('a refresh keeps the weeks under way and their checks', () => {
    const plan = storedPlan();
    const progress: PlanProgress = { planId: plan.id, startDay: '2026-11-01', done: [{ id: 'Ab12Cd34-3-1', day: '2026-11-15' }] };
    expect(keptWeeks(plan, progress, 3)).toBe(3); // week 3 has a check, so it stays
    expect(keptWeeks(plan, { ...progress, done: [] }, 3)).toBe(2);
    const fresh = checkPlan({ weeks: goodWeeks(4) }, ctx({ planId: 'Zz99Yy88', fromWeek: 4 })).weeks;
    const merged = mergeRefresh(plan, fresh, 3);
    expect(merged.map((w) => w.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(merged[2].items[0].id).toBe('Ab12Cd34-3-1');
    expect(merged[3].items[0].id).toBe('Zz99Yy88-4-1');
  });

  it('Free sees week 1 and locked shells; checks outside week 1 are not shown', () => {
    const plan = storedPlan();
    const progress: PlanProgress = { planId: plan.id, startDay: '2026-11-01', done: [{ id: 'Ab12Cd34-1-1', day: '2026-11-02' }, { id: 'Ab12Cd34-2-1', day: '2026-11-09' }] };
    const free = planView(plan, progress, { pro: false, today: '2026-11-15', stale: false });
    expect(free.locked).toBe(true);
    expect(free.weeks[0].items).toHaveLength(3);
    expect(free.weeks.slice(1).every((w) => w.locked && w.items.length === 0 && w.focus === '')).toBe(true);
    expect(free.done).toEqual(['Ab12Cd34-1-1']);
    const pro = planView(plan, progress, { pro: true, today: '2026-11-15', stale: true });
    expect(pro.currentWeek).toBe(3);
    expect(pro.done).toHaveLength(2);
    expect(pro.stale).toBe(true);
  });

  it('summarises the current week for Home and Progress', () => {
    const plan = storedPlan();
    const progress: PlanProgress = { planId: plan.id, startDay: '2026-11-01', done: [{ id: 'Ab12Cd34-2-1', day: '2026-11-09' }, { id: 'Ab12Cd34-2-2', day: '2026-11-10' }] };
    const s = planSummary(plan, progress, { pro: true, today: '2026-11-10', xrayId: plan.xrayId });
    expect(s).toMatchObject({ status: 'ready', currentWeek: 2, weekDone: 2, weekTotal: 3, totalDone: 2, total: 37 });
    expect(s.next?.id).toBe('Ab12Cd34-2-3');
    expect(planSummary(null, undefined, { pro: true, today: '2026-11-10', xrayId: null }).status).toBe('none');
  });

  it('the inputs key changes with the week or the skills, not with the order of shares', () => {
    const shares = [
      { taskId: '1841', share: 60 },
      { taskId: '1842', share: 40 },
    ];
    const a = planInputsKey({ occupationCode: '29-1141.00', shares, skills: undefined });
    expect(planInputsKey({ occupationCode: '29-1141.00', shares: [...shares].reverse(), skills: undefined })).toBe(a);
    expect(planInputsKey({ occupationCode: '29-1141.00', shares: [{ taskId: '1841', share: 50 }, { taskId: '1842', share: 50 }], skills: undefined })).not.toBe(a);
    const skillsRec = { items: [{ id: 'sk_1', name: 'Epic', kind: 'tool' as const, onetId: null, tech: 'Epic Systems', source: 'added' as const, quotes: [], years: null, at: '' }], shown: [], checked: [], removed: [], occupationCode: null, textHash: null, seniorityYears: null, extractedAt: null, updatedAt: '' };
    expect(planInputsKey({ occupationCode: '29-1141.00', shares, skills: skillsRec })).not.toBe(a);
  });
});
