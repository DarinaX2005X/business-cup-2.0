import { describe, expect, it } from 'vitest';
import type { ProofEntry } from '@/domain/types';
import { qrMatrix, rsDivisor, rsRemainder } from '@/components/profile/qr';
import { calendarFrom, caughtCount, hoursPractised, mondayOf, repDaysOf, scoreHistoryFrom, summaryPhrase, type MapInput, type RepInput } from './core';
import { checkDraft, numbersIn } from './review-kit';

const rep = (id: string, day: string, score: number, from: number, to: number): RepInput => ({
  id,
  at: `${day}T10:00:00.000Z`,
  day,
  type: 'slip',
  taskId: 't1',
  taskShort: 'Charting',
  score,
  summary: { key: 'progress.proof.slip', params: { found: 2, total: 3, doc: 'progress note' } },
  change: { from: Math.round(from), to: Math.round(to), fromExact: from, toExact: to },
});

const map = (createdAt: string): MapInput => ({
  id: 'x1',
  jobTitle: 'Registered Nurse',
  createdAt,
  createdDay: createdAt.slice(0, 10),
  editedAt: null,
  editedDay: null,
  exactWith: () => 70,
});

describe('progress core', () => {
  it('draws a map point and one point per rep with its reason, after three reps on three days', () => {
    const points = scoreHistoryFrom(
      [map('2026-11-10T09:00:00.000Z')],
      [rep('r1', '2026-11-10', 0.67, 70, 70.6), rep('r2', '2026-11-11', 1, 70.6, 71.9), rep('r3', '2026-11-12', 0.8, 71.9, 72.8)],
    );
    expect(points.map((p) => p.kind)).toEqual(['map', 'rep', 'rep', 'rep']);
    expect(points[0].score).toBe(70); // the first rep's starting score
    expect(points.slice(1).map((p) => p.score)).toEqual([71, 72, 73]);
    expect(points[3].before).toBe(72);
    expect(points[1].reason.key).toBe('progress.proof.slip');
  });

  it('skips reps checked without a map and computes the map point without a following rep', () => {
    const points = scoreHistoryFrom([map('2026-11-12T09:00:00.000Z')], [{ ...rep('r0', '2026-11-11', 1, 0, 0) }]);
    expect(points).toHaveLength(1);
    expect(points[0].exact).toBe(70);
  });

  it('marks three warm days in the 12-week calendar', () => {
    const log = [
      { id: 'a', taskId: 't1', type: 'slip' as const, kind: 'daily' as const, day: '2026-11-12', score: 0.9 },
      { id: 'b', taskId: 't1', type: 'slip' as const, kind: 'daily' as const, day: '2026-11-13', score: 0.8 },
      { id: 'c', taskId: 't2', type: 'slip' as const, kind: 'extra' as const, day: '2026-11-14', score: 0.4 },
      { id: 'd', taskId: 't2', type: 'slip' as const, kind: 'daily' as const, day: '2026-11-15' }, // open rep: not counted
    ];
    const cal = calendarFrom(repDaysOf(log), '2026-11-15', '2026-11-10');
    expect(cal).toHaveLength(84);
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(cal[0].day).toBe('2026-08-24');
    expect(cal.filter((d) => d.reps > 0).map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(cal.find((d) => d.day === '2026-11-09')?.before).toBe(true);
    expect(cal.at(-1)?.future).toBe(false); // 2026-11-15 is a Sunday
  });

  it('counts hours only for tasks practised well twice, and caught mistakes from slip and delegate', () => {
    const log = [
      { id: 'a', taskId: 't1', type: 'slip' as const, kind: 'daily' as const, day: '2026-11-12', score: 0.9 },
      { id: 'b', taskId: 't1', type: 'delegate' as const, kind: 'daily' as const, day: '2026-11-13', score: 0.7 },
      { id: 'c', taskId: 't2', type: 'slip' as const, kind: 'daily' as const, day: '2026-11-14', score: 0.95 },
    ];
    expect(hoursPractised([{ taskId: 't1', share: 15 }, { taskId: 't2', share: 85 }], log)).toBe(6);
    const proof: ProofEntry[] = [
      { id: 'p1', repId: 'a', type: 'slip' as const, taskId: 't1', occupationCode: 'x', score: 0.9, summaryKey: 'proof.slip', summaryParams: { found: 2, total: 3, doc: 'note', workMinutes: 30 }, at: '', public: false },
      { id: 'p2', repId: 'b', type: 'delegate' as const, taskId: 't1', occupationCode: 'x', score: 0.7, summaryKey: 'proof.delegate', summaryParams: { met: 3, criteria: 4, traps: 1, trapsTotal: 2 }, at: '', public: false },
    ];
    expect(caughtCount(proof)).toBe(3);
    expect(summaryPhrase(proof[0]).params).not.toHaveProperty('workMinutes');
  });
});

describe('review kit number check', () => {
  it('keeps items whose numbers are in the facts and drops invented ones', () => {
    const facts = '1839 | AI speeds it up | 6 | Charting\n1839 | Spot the slip | 86 | found 2 of 3 mistakes';
    expect(numbersIn('4,5 h and 12.0 points')).toEqual(['4.5', '12']);
    const { draft, dropped } = checkDraft(
      {
        changed: [
          { taskId: '1839', text: 'I draft charting with AI for 6 hours a week and check every dose.' },
          { taskId: '1839', text: 'This saved my unit 14 hours a month.' },
          { taskId: '9999', text: 'A task that is not mine.' },
        ],
        judgment: [{ taskId: '1839', text: 'I caught 2 of 3 planted mistakes in an AI-drafted note.' }],
        next: [{ text: 'Take on 3 new patients.' }],
      },
      facts,
      new Set(['1839']),
    );
    expect(draft.changed.map((i) => i.text)).toEqual(['I draft charting with AI for 6 hours a week and check every dose.']);
    expect(draft.judgment).toHaveLength(1);
    expect(draft.next).toHaveLength(1); // 3 is in the facts
    expect(dropped).toBe(2);
  });
});

describe('restore link QR', () => {
  it('matches the Reed–Solomon reference vector and sizes the code by length', () => {
    expect(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    expect(qrMatrix('hi')).toHaveLength(21);
    const link = `https://irreplaceable-gamma.vercel.app/#restore=${'A'.repeat(22)}.${'b'.repeat(43)}`;
    expect(qrMatrix(link)?.length).toBe(45); // version 7
    expect(qrMatrix('x'.repeat(300))).toBeNull();
  });
});
