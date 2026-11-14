import { describe, expect, it } from 'vitest';
import type { RepRecord } from '@/domain/reps';
import type { OccupationBundle } from '@/domain/types';
import { practiceByTask, PRACTICE_BAR } from './personal';
import { prepareText, verifyMarks } from './second-look';
import { applyStarter, cleanInstruction } from './starter';

const LETTER = prepareText(`Dear Mrs. Alvarez,

Thank you for coming in today. Here is a summary of your new plan.

- Start metoprolol 250 mg by mouth twice a day, with food.
- Check your blood pressure every morning and write it down.
- Call us if you feel dizzy or your heart rate drops below 50.

Your next appointment is on Tuesday, March 3.

Best wishes,
The Cardiology Clinic team`);

describe('verifyMarks', () => {
  it('keeps a mark whose quote is in the text and points at it', () => {
    const marks = verifyMarks(LETTER, [
      { quote: 'Start metoprolol 250 mg by mouth twice a day', type: 'calculation', why: 'This is ten times a usual starting dose.', check: 'Compare the dose with the prescriber’s order.' },
    ]);
    expect(marks).toHaveLength(1);
    expect(LETTER.slice(marks[0].start, marks[0].end)).toBe('Start metoprolol 250 mg by mouth twice a day');
    expect(marks[0].type).toBe('calculation');
  });

  it('drops quotes that are not in the text, too short, or without a reason', () => {
    const marks = verifyMarks(LETTER, [
      { quote: 'Start lisinopril 40 mg daily', type: 'fact', why: 'x', check: 'y' },
      { quote: 'mg', type: 'fact', why: 'Short.', check: 'Short.' },
      { quote: 'Check your blood pressure every morning', type: 'omission', why: '', check: 'Ask what number is too high.' },
    ]);
    expect(marks).toHaveLength(0);
  });

  it('finds a quote that differs only in case, quotes and spacing, and never overlaps two marks', () => {
    const marks = verifyMarks(LETTER, [
      { quote: '“call us if you feel  dizzy”', type: 'omission', why: 'No number to call is given.', check: 'Add the clinic phone line.' },
      { quote: 'Call us if you feel dizzy or your heart rate', type: 'logic', why: 'Overlaps the first one.', check: 'Same place.' },
    ]);
    expect(marks).toHaveLength(1);
    expect(LETTER.slice(marks[0].start, marks[0].end).toLowerCase()).toBe('call us if you feel dizzy');
  });

  it('refuses a «mark» over most of the text and caps the list at six, in reading order', () => {
    const lines = Array.from({ length: 9 }, (_, i) => `Line number ${i + 1} says something specific here.`);
    const doc = prepareText(lines.join('\n'));
    const raw = [...lines].reverse().map((l) => ({ quote: l, type: 'fact' as const, why: 'Check the line.', check: 'Compare it with the source.' }));
    const marks = verifyMarks(doc, raw);
    expect(marks).toHaveLength(6);
    expect(marks.map((m) => m.start)).toEqual([...marks.map((m) => m.start)].sort((a, b) => a - b));
    expect(verifyMarks(doc, [{ quote: doc, type: 'tone', why: 'All of it.', check: 'All of it.' }])).toHaveLength(0);
  });

  it('returns nothing for a clean text, which the screen shows as «Nothing obvious to check»', () => {
    expect(verifyMarks(LETTER, [])).toEqual([]);
  });
});

const bundle = {
  tasks: [
    { id: 'a', text: 'Maintain accurate, detailed reports and records.', evidence: { category: 'ai_speeds' } },
    { id: 'b', text: 'Administer medications to patients.', evidence: { category: 'human_edge' } },
  ],
} as unknown as Pick<OccupationBundle, 'tasks'>;

const instruction =
  'You are helping me write a shift handoff note for the next nurse. Use only the facts in [paste my notes from this shift]. Write it in SBAR order with short lines. List every medication with its dose and time exactly as written in my notes. At the end, list anything missing, unclear or contradictory instead of guessing.';

describe('applyStarter', () => {
  it('keeps known AI tasks with a usable instruction and 3 to 5 distinct checks', () => {
    const out = applyStarter(
      {
        tasks: [
          { taskId: 'a', instruction: `**${instruction}**`, checks: ['1. Every dose matches the medication record.', 'Every dose matches the medication record.', 'Allergies are listed exactly as charted.', 'Times are in the order the meds were given.', 'Pending labs are named.', 'Vital signs match the flowsheet.', 'Code status is stated.'] },
          { taskId: 'b', instruction, checks: ['One.', 'Two.', 'Three.'] },
          { taskId: 'zz', instruction, checks: ['x', 'y', 'z'] },
        ],
      },
      bundle,
    );
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a.instruction.startsWith('You are helping')).toBe(true);
    expect(out.a.checks).toHaveLength(5);
    expect(out.a.checks[0]).toBe('Every dose matches the medication record.');
  });

  it('drops a task with fewer than three checks', () => {
    expect(applyStarter({ tasks: [{ taskId: 'a', instruction, checks: ['Every dose matches the record.', 'Allergies match the chart.'] }] }, bundle)).toEqual({});
  });

  it('cleans markdown headings but keeps short lists', () => {
    expect(cleanInstruction('## Task\n* first\n* second')).toBe('Task\n- first\n- second');
  });
});

const rep = (over: Partial<RepRecord>): RepRecord =>
  ({
    id: 'r1',
    profileId: 'p1',
    type: 'delegate',
    taskId: 'a',
    occupationCode: '29-1141.00',
    locale: 'en',
    day: '2026-11-14',
    kind: 'daily',
    status: 'done',
    source: 'live',
    seed: 's',
    difficulty: 1,
    title: 't',
    brief: 'b',
    createdAt: '2026-11-14T10:00:00Z',
    completedAt: '2026-11-14T10:10:00Z',
    ...over,
  }) as RepRecord;

const delegate = (id: string, score: number, text: string, caught: string[], at: string) =>
  rep({
    id,
    completedAt: at,
    delegate: {
      scenario: 's',
      inputs: 'i',
      goal: 'g',
      criteria: [],
      instruction: text,
      traps: [
        { id: 't1', description: 'The medication list gives amlodipine 5 mg, another line says 10 mg.', keywords: ['5 mg'] },
        { id: 't2', description: 'The discharge date is listed twice with different days.', keywords: ['06/17'] },
      ],
    },
    result: { score, points: 10, trapsCaught: caught, scoreChange: { before: 1, after: 1, from: 1, to: 1, fromExact: 1, toExact: 1 } },
  });

describe('practiceByTask', () => {
  const opts = { profileId: 'p1', occupationCode: '29-1141.00', taskIds: ['a'] };

  it("takes the best scored instruction and puts the missed trap into the checklist", () => {
    const res = practiceByTask(
      [delegate('r1', 0.86, 'My handout instruction.', ['t2'], '2026-11-14T10:00:00Z'), delegate('r2', 0.5, 'Weaker one.', ['t1', 't2'], '2026-11-13T10:00:00Z')],
      opts,
    ).get('a')!;
    expect(res.best).toMatchObject({ text: 'My handout instruction.', score: 0.86, repId: 'r1' });
    expect(res.best!.score).toBeGreaterThanOrEqual(PRACTICE_BAR);
    expect(res.checks.map((c) => c.text)).toEqual(['The medication list gives amlodipine 5 mg, another line says 10 mg.']);
    expect(res.checks[0].origin).toBe('trap');
    expect(res.delegated).toBe(true);
  });

  it('adds missed Spot the slip mistakes and ignores other people, other jobs and open reps', () => {
    const slip = rep({
      id: 's1',
      type: 'slip',
      slip: { document: 'd', errors: [] },
      reveal: {
        errors: [
          { quote: 'q', start: 0, end: 1, type: 'calculation', explanation: 'The 24-hour intake total does not add up.', fix: 'f' },
          { quote: 'q', start: 2, end: 3, type: 'fact', explanation: 'Found one.', fix: 'f' },
        ],
      },
      result: { score: 0.5, points: 5, errorsFound: [false, true], scoreChange: { before: 1, after: 1, from: 1, to: 1, fromExact: 1, toExact: 1 } },
    });
    const res = practiceByTask(
      [slip, rep({ id: 'x', profileId: 'someone' }), rep({ id: 'y', occupationCode: '13-2011.00' }), rep({ id: 'z', status: 'open' })],
      opts,
    ).get('a')!;
    expect(res.best).toBeNull();
    expect(res.delegated).toBe(false);
    expect(res.checks).toEqual([expect.objectContaining({ origin: 'slip', slipType: 'calculation', text: 'The 24-hour intake total does not add up.' })]);
  });
});
