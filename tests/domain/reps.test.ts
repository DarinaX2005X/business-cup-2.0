import { describe, expect, it } from 'vitest';
import {
  applyStreak,
  buildAiOrMeRound,
  chooseTask,
  copiesInputs,
  delegateScore,
  gradeSlip,
  keywordCriteria,
  localDay,
  mergeRanges,
  normalizeDocument,
  quoteIn,
  scoreAiOrMe,
  streakAsOf,
  trapsCaught,
  validateSlip,
  verifyCriteria,
  type Range,
} from '@/domain/reps';
import type { Profile } from '@/domain/types';
import { fixture } from './helpers';

// A slip in the stored form, with three planted mistakes.
const DOC = normalizeDocument(`# Discharge Instructions
Riverside Medical Center, Unit 5 West

| Patient | Allergies | Discharge date |
| --- | --- | --- |
| Harold Benning, 71 | Penicillin (hives) | 11/14/2026 |

You were treated for community-acquired pneumonia and are ready to go home.

## Medications
- Take amoxicillin 500 mg by mouth three times daily for 5 days.
- Continue metoprolol 25 mg by mouth twice daily.
- Take acetaminophen 650 mg every 6 hours as needed for fever, no more than 3,000 mg a day.

## Follow-up
- See your PCP Dr. Alvarez for a check of your lungs.
- Your oxygen level today was 88% on room air, which is normal for going home.
- Call 911 for chest pain or severe shortness of breath.

## Activity and diet
Walk short distances several times a day and increase slowly. Drink at least 6 cups of fluids a day unless your doctor told you to limit fluids. Avoid smoking and secondhand smoke. Rest when you feel tired and do not lift more than 10 lb for the first week.

## When to call
Call the unit at 555-0142 if your temperature is above 100.4 °F, if your cough brings up blood, or if you feel more tired each day instead of less. Bring this sheet and your medication list to every visit.`);

const draft = {
  title: 'Discharge Instructions',
  brief: 'Discharge instructions for a patient going home after pneumonia, drafted from the chart.',
  docType: 'discharge instructions',
  document: DOC,
  errors: [
    { quote: 'Take amoxicillin 500 mg by mouth three times daily', type: 'compliance', explanation: 'Penicillin allergy.', fix: 'Take doxycycline 100 mg by mouth twice daily' },
    { quote: 'See your PCP Dr. Alvarez for a check of your lungs', type: 'omission', explanation: 'No time frame.', fix: 'See your PCP Dr. Alvarez within 7 days' },
    { quote: 'oxygen level today was 88% on room air', type: 'fact', explanation: '88% is low.', fix: 'oxygen level today was 95% on room air' },
  ],
};
const RULES = { n: 3, types: ['fact', 'omission', 'compliance'] as const };

function validSlip() {
  const v = validateSlip(draft, { ...RULES, types: [...RULES.types] });
  if (!v.ok) throw new Error(v.problems.join('\n'));
  return v.content.slip;
}
const at = (s: string, q: string): Range => {
  const i = s.indexOf(q);
  if (i < 0) throw new Error(`not found: ${q}`);
  return [i, i + q.length];
};

describe('validateSlip', () => {
  it('normalises the document and turns quotes into exact, sorted ranges', () => {
    const slip = validSlip();
    expect(slip.errors).toHaveLength(3);
    for (const e of slip.errors) expect(slip.document.slice(e.start, e.end)).toBe(e.quote);
    expect(slip.errors.map((e) => e.start)).toEqual([...slip.errors.map((e) => e.start)].sort((a, b) => a - b));
  });

  it('stores the normalised document: CRLF, tabs, double spaces and curly quotes are cleaned before matching', () => {
    const messy = { ...draft, document: DOC.replace(/\n/g, '\r\n').replace('Take amoxicillin', 'Take\t amoxicillin  ').replace("You were", '“You were”') };
    const v = validateSlip(messy, { ...RULES, types: [...RULES.types] });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.content.slip.document).not.toMatch(/\r|\t| {2}/);
      expect(v.content.slip.document).toContain('"You were"');
    }
  });

  it('repairs case and trailing punctuation only when the result is in the document', () => {
    const v = validateSlip(
      { ...draft, errors: [{ ...draft.errors[0], quote: 'take Amoxicillin 500 mg by mouth three times daily.' }, ...draft.errors.slice(1)] },
      { ...RULES, types: [...RULES.types] },
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.content.slip.errors[0].quote).toBe('Take amoxicillin 500 mg by mouth three times daily');
  });

  it('rejects missing, repeated, multi-line, marked-up, too short and overlapping quotes with a reason', () => {
    const bad = (quote: string) => validateSlip({ ...draft, errors: [{ ...draft.errors[0], quote }, ...draft.errors.slice(1)] }, { ...RULES, types: [...RULES.types] });
    const problems = (v: ReturnType<typeof bad>) => (v.ok ? '' : v.problems.join(' '));
    expect(problems(bad('Take ampicillin 500 mg by mouth'))).toMatch(/does not appear/);
    expect(problems(bad('by mouth'))).toMatch(/appears \d+ times/);
    expect(problems(bad('three times daily for 5 days.\n- Continue metoprolol'))).toMatch(/several lines|spans/);
    expect(problems(bad('| Harold Benning, 71 |'))).toMatch(/markup/);
    expect(problems(bad('Rest when you'))).toMatch(/4–30/);
    expect(problems(bad('three times daily for 5 days'))).toBe('');
    const overlap = validateSlip(
      { ...draft, errors: [draft.errors[0], { ...draft.errors[1], quote: 'amoxicillin 500 mg by mouth three times daily for 5 days' }, draft.errors[2]] },
      { ...RULES, types: [...RULES.types] },
    );
    expect(overlap.ok ? '' : overlap.problems.join(' ')).toMatch(/overlap/);
  });

  it('rejects the wrong number of mistakes, unknown types and placeholders', () => {
    const v = validateSlip({ ...draft, document: `${DOC}\nSigned: [Nurse name]`, errors: [{ ...draft.errors[0], type: 'tone' }] }, { ...RULES, types: [...RULES.types] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const all = v.problems.join(' ');
      expect(all).toMatch(/exactly 3/);
      expect(all).toMatch(/type "tone"/);
      expect(all).toMatch(/placeholders/);
    }
  });
});

describe('gradeSlip', () => {
  const slip = validSlip();
  const errs = slip.errors;
  const len = slip.document.length;
  const exact = errs.map((e): Range => [e.start, e.end]);
  const falseA = at(slip.document, 'Continue metoprolol 25 mg');
  const falseB = at(slip.document, 'Avoid smoking and secondhand smoke');
  const falseC = at(slip.document, 'Bring this sheet');

  it('exact highlights find every mistake: score 1', () => {
    expect(gradeSlip(errs, exact, len)).toMatchObject({ score: 1, found: 3, total: 3, falseFlags: 0, flags: [] });
  });

  it('a partial highlight counts from 40% of the quote', () => {
    const e = errs[0];
    const span = e.end - e.start;
    const enough: Range = [e.start, e.start + Math.ceil(span * 0.4)];
    const short: Range = [e.start, e.start + Math.floor(span * 0.39)];
    expect(gradeSlip(errs, [enough], len).errorsFound[0]).toBe(true);
    expect(gradeSlip(errs, [short], len).errorsFound[0]).toBe(false);
    // the short highlight is mostly on the mistake, so it is not a false flag either
    expect(gradeSlip(errs, [short], len).falseFlags).toBe(0);
  });

  it('overlapping and touching highlights are merged before grading', () => {
    const e = errs[1];
    const mid = Math.floor((e.start + e.end) / 2);
    const g = gradeSlip(errs, [[e.start, mid + 3], [mid - 3, e.end], [e.start + 2, mid]], len);
    expect(g.ranges).toEqual([[e.start, e.end]]);
    expect(g.found).toBe(1);
  });

  it('one false highlight is free ("Not on our list"), each further one costs 0.15', () => {
    expect(gradeSlip(errs, [...exact, falseA], len)).toMatchObject({ score: 1, falseFlags: 1 });
    expect(gradeSlip(errs, [...exact, falseA, falseB], len)).toMatchObject({ score: 0.85, falseFlags: 2 });
    expect(gradeSlip(errs, [...exact, falseA, falseB, falseC], len)).toMatchObject({ score: 0.7, falseFlags: 3 });
    expect(gradeSlip(errs, [exact[0], falseA], len)).toMatchObject({ score: 0.33, found: 1 });
  });

  it('a long highlight that only grazes a mistake is a false flag and does not find it', () => {
    const e = errs[2];
    const graze: Range = [e.end - 3, e.end + 120];
    const g = gradeSlip(errs, [graze], len);
    expect(g.errorsFound[2]).toBe(false);
    expect(g.falseFlags).toBe(1);
  });

  it('selecting everything scores 0 with over_selected, even though every mistake is covered', () => {
    const g = gradeSlip(errs, [[0, len]], len);
    expect(g).toMatchObject({ score: 0, found: 3, flags: ['over_selected'] });
    expect(gradeSlip(errs, [[0, Math.floor(len * 0.61)]], len).flags).toContain('over_selected');
  });

  it('an empty answer scores 0; out-of-range and reversed ranges are clamped; at most 12 ranges', () => {
    expect(gradeSlip(errs, [], len)).toMatchObject({ score: 0, found: 0, falseFlags: 0 });
    expect(mergeRanges([[len + 50, -10]], len)).toEqual([[0, len]]);
    const many = Array.from({ length: 20 }, (_, i): Range => [i * 10, i * 10 + 3]);
    expect(mergeRanges(many, len)).toHaveLength(12);
  });
});

describe('rubric grading', () => {
  const rubric = [
    { id: 'c1', text: 'Says who the result is for', keywords: ['night shift', 'oncoming nurse'] },
    { id: 'c2', text: 'Asks to reconcile doses', keywords: ['reconcile', 'double-check'] },
  ];
  const instruction = 'Write a handoff for the oncoming nurse. Use SBAR, under 150 words.';

  it('a met grade survives only with a quote that is really in the person\'s text', () => {
    const out = verifyCriteria(
      rubric,
      [
        { id: 'c1', status: 'met', quote: 'handoff for the oncoming nurse', note: 'Clear audience.' },
        { id: 'c2', status: 'met', quote: 'reconcile every dose', note: 'x' },
      ],
      instruction,
    );
    expect(out[0]).toMatchObject({ status: 'met', quote: 'handoff for the oncoming nurse' });
    expect(out[1].status).toBe('missed');
  });

  it('quoteIn ignores case, punctuation and spacing but not words', () => {
    expect(quoteIn(instruction, 'USE SBAR,   under 150 words')).toBe(true);
    expect(quoteIn(instruction, 'use SOAP')).toBe(false);
    expect(quoteIn(instruction, null)).toBe(false);
  });

  it('keyword grading (model unavailable) quotes the sentence that matched', () => {
    const out = keywordCriteria(rubric, instruction);
    expect(out[0]).toMatchObject({ status: 'met', quote: 'Write a handoff for the oncoming nurse.' });
    expect(out[1].status).toBe('missed');
  });

  it('delegate score = criteria × 0.7 + traps × 0.3', () => {
    expect(delegateScore([{ status: 'met' }, { status: 'partly' }, { status: 'missed' }, { status: 'met' }], 1, 2)).toBe(0.59);
    expect(delegateScore([{ status: 'met' }], 2, 2)).toBe(1);
  });
});

describe('traps', () => {
  const inputs = 'MAR: metoprolol 25 mg PO BID. Day note: metoprolol 50 mg given at 0900. K+ 3.1 mmol/L this morning, no repeat ordered.';
  const traps = [
    { id: 't1', description: 'Two metoprolol doses', keywords: ['50 mg'] },
    { id: 't2', description: 'Low potassium without follow-up', keywords: ['K+ 3.1'] },
  ];
  const run = 'Handoff: metoprolol 50 mg given at 0900. Labs: K+ 3.1 mmol/L. Stable.';

  it('is caught by naming a keyword in the instruction, or by highlighting it in the result', () => {
    expect(trapsCaught(traps, 'Summarize and flag anything odd about the 50 mg dose.', run, [], inputs)).toEqual(['t1']);
    const i = run.indexOf('K+ 3.1');
    expect(trapsCaught(traps, 'Write the handoff.', run, [[i, i + 4]], inputs)).toEqual(['t2']);
    expect(trapsCaught(traps, 'Write the handoff.', run, [], inputs)).toEqual([]);
  });

  it('matches the value inside a longer keyword, also in the fix sentence, and a verified grader finding', () => {
    const t = [{ id: 't1', description: 'Order vs MAR dose', keywords: ['Lasix 20 mg', '40 mg given'] }, { id: 't2', description: 'O2', keywords: ['3L NC'] }];
    expect(trapsCaught(t, 'Flag any mismatch, for example 20 mg vs 40 mg furosemide.', 'x', [], inputs)).toEqual(['t1']);
    expect(trapsCaught(t, 'Write the handoff.', 'x', [], inputs, 'Check the 20 mg order against the MAR.')).toEqual(['t1']);
    expect(trapsCaught(t, 'Write the handoff.', 'x', [], inputs, '', ['t2'])).toEqual(['t2']);
    expect(trapsCaught(t, 'Write the handoff, 120 mg max.', 'x', [], inputs)).toEqual([]);
  });

  it('pasting the input material into the instruction does not count as naming the trap', () => {
    const pasted = `Write the handoff from this: ${inputs}`;
    expect(copiesInputs(pasted, inputs)).toBe(true);
    expect(trapsCaught(traps, pasted, run, [], inputs)).toEqual([]);
  });
});

describe('streak and days', () => {
  const empty: Profile['streak'] = { current: 0, best: 0, lastDay: null, days: [], freezes: 0 };

  it('two days in a row give 2, the same day changes nothing, a gap restarts at 1', () => {
    const d1 = applyStreak(empty, '2026-11-14');
    const d2 = applyStreak(d1, '2026-11-15');
    expect(d2).toMatchObject({ current: 2, best: 2, lastDay: '2026-11-15', days: ['2026-11-14', '2026-11-15'] });
    expect(applyStreak(d2, '2026-11-15')).toBe(d2);
    const d4 = applyStreak(d2, '2026-11-17');
    expect(d4).toMatchObject({ current: 1, best: 2 });
  });

  it('keeps 14 days and reads a broken streak as 0', () => {
    let s = empty;
    for (let i = 0; i < 20; i++) s = applyStreak(s, `2026-10-${String(i + 1).padStart(2, '0')}`);
    expect(s.days).toHaveLength(14);
    expect(s.current).toBe(20);
    expect(streakAsOf(s, '2026-10-21').current).toBe(20);
    expect(streakAsOf(s, '2026-10-22').current).toBe(0);
  });

  it('local day follows the zone', () => {
    const t = new Date('2026-11-14T03:00:00Z');
    expect(localDay(t, 'Asia/Almaty')).toBe('2026-11-14');
    expect(localDay(t, 'America/Los_Angeles')).toBe('2026-11-13');
    expect(localDay(t, 'Not/AZone')).toBe('2026-11-14');
  });
});

describe('task choice', () => {
  const nurse = fixture('29-1141.00');
  const byId = new Map(nurse.tasks.map((t) => [t.id, t]));
  const aiTasks = nurse.tasks.filter((t) => t.evidence.category === 'ai_speeds' || t.evidence.category === 'ai_does');
  const humanTasks = nurse.tasks.filter((t) => t.evidence.category === 'human_edge');
  const shares = [
    { taskId: aiTasks[0].id, share: 40 },
    { taskId: aiTasks[1].id, share: 20 },
    { taskId: humanTasks[0].id, share: 30 },
    { taskId: humanTasks[1].id, share: 10 },
  ];
  const base = { tasks: nurse.tasks, shares, repLog: [] as Profile['repLog'], day: '2026-11-14' };

  it('slip takes an AI task of the week, edge a human-edge task, deterministically', () => {
    for (let i = 0; i < 20; i++) {
      const slip = chooseTask({ ...base, type: 'slip', seed: `s${i}` })!;
      expect(['ai_does', 'ai_speeds']).toContain(byId.get(slip)!.evidence.category);
      const edge = chooseTask({ ...base, type: 'edge', seed: `s${i}` })!;
      expect(byId.get(edge)!.evidence.category).toBe('human_edge');
    }
    expect(chooseTask({ ...base, type: 'slip', seed: 'x' })).toBe(chooseTask({ ...base, type: 'slip', seed: 'x' }));
  });

  it('skips tasks used in the last 5 days, then falls back to the nearest category', () => {
    const repLog: Profile['repLog'] = [
      { id: 'a', taskId: aiTasks[0].id, type: 'slip', kind: 'daily', day: '2026-11-12' },
      { id: 'b', taskId: aiTasks[1].id, type: 'slip', kind: 'daily', day: '2026-11-13' },
    ];
    const t = chooseTask({ ...base, repLog, type: 'slip', seed: 'q' })!;
    expect(byId.get(t)!.evidence.category).toBe('human_edge'); // no AI task left without a repeat
    const old: Profile['repLog'] = [{ ...repLog[0], day: '2026-11-01' }, repLog[1]];
    expect(chooseTask({ ...base, repLog: old, type: 'slip', seed: 'q' })).toBe(aiTasks[0].id);
  });
});

describe('AI or me?', () => {
  const acc = fixture('13-2011.00');
  const shares = acc.tasks.slice(0, 8).map((t) => ({ taskId: t.id, share: 12.5 }));
  const texts = {};

  it('is the same all day, different the next day, with 2+2+1 scored cards and facts from the data', () => {
    const a = buildAiOrMeRound(acc, shares, 'P1', '2026-11-14', texts);
    const b = buildAiOrMeRound(acc, shares, 'P1', '2026-11-14', texts);
    const c = buildAiOrMeRound(acc, shares, 'P1', '2026-11-15', texts);
    expect(b).toEqual(a);
    expect(c.roundId).not.toBe(a.roundId);
    expect(a.cards).toHaveLength(5);
    expect(a.cards.filter((x) => x.answer === 'ai').length).toBeGreaterThanOrEqual(2);
    expect(a.cards.filter((x) => x.answer === 'human').length).toBeGreaterThanOrEqual(2);
    const observed = a.cards.find((x) => x.fact.key === 'today.aiOrMe.fact.observed');
    expect(observed?.fact.params.automation).toEqual(expect.any(Number));
    const inWeek = a.cards.find((x) => shares.some((s) => s.taskId === x.taskId));
    if (inWeek) expect(inWeek.fact.params.hours).toBe(5);
  });

  it('unanswered cards are wrong; uncounted cards are not scored', () => {
    const cards = [
      { answer: 'ai' as const, counted: true },
      { answer: 'human' as const, counted: true },
      { answer: 'human' as const, counted: false },
    ];
    expect(scoreAiOrMe(cards, ['ai', null, 'human'])).toEqual({ correct: [true, false, true], right: 1, total: 2 });
  });
});
