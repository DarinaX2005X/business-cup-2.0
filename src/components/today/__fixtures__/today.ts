/*
 * Today screen states in the exact shapes of the reps API (03.1), for the state gallery and for
 * development (`/today?fixture=<name>`, ignored in production). Task texts and the AI-or-me round were
 * taken from a live response for a Registered Nurse week; the slip document is the kit's gallery sheet.
 */

import { repDocument, repErrors } from '@/components/kit/__fixtures__/rep';
import type { AiOrMeRoundFull, RepView } from '@/domain/reps';
import type { ChoiceTask, Hub, Streak, TodayPro } from '../api';
import type { TodayFixture } from '../TodayScreen';

const day = '2026-11-14';

const streak: Streak = { current: 2, best: 4, lastDay: '2026-11-13', days: ['2026-11-10', '2026-11-12', '2026-11-13'], freezes: 0 };

const choiceTasks: Record<'slip' | 'delegate' | 'edge', ChoiceTask> = {
  slip: { type: 'slip', taskId: '1850', taskText: 'Instruct individuals, families, or other groups on topics such as health education, disease prevention, or childbirth and develop health improvement programs.', taskShort: 'Patient education', minutes: 5 },
  delegate: { type: 'delegate', taskId: '1839', taskText: 'Maintain accurate, detailed reports and records.', taskShort: 'Patient charting', minutes: 10 },
  edge: { type: 'edge', taskId: '20413', taskText: 'Administer medications to patients and monitor patients for reactions or side effects.', taskShort: 'Medication administration', minutes: 8 },
};

export const aiOrMeRound: AiOrMeRoundFull = {
  roundId: '2026-11-14-mo0yj1',
  day,
  cards: [
    { taskId: '20413', text: 'Administer medications to patients and monitor patients for reactions or side effects.', answer: 'human', counted: true, fact: { key: 'today.aiOrMe.fact.hands_on', params: { hours: 5 } } },
    { taskId: '1850', text: 'Instruct individuals, families, or other groups on topics such as health education, disease prevention, or childbirth and develop health improvement programs.', answer: 'ai', counted: true, fact: { key: 'today.aiOrMe.fact.estimate', params: { hours: 2.5, exposure: 38 } } },
    { taskId: '1839', text: 'Maintain accurate, detailed reports and records.', answer: 'ai', counted: true, fact: { key: 'today.aiOrMe.fact.estimate', params: { hours: 5, exposure: 38 } } },
    { taskId: '1855', text: 'Provide health care, first aid, immunizations, or assistance in convalescence or rehabilitation in locations such as schools, hospitals, or industry.', answer: 'human', counted: true, fact: { key: 'today.aiOrMe.fact.hands_on', params: { hours: 3 } } },
    { taskId: '1843', text: 'Consult and coordinate with healthcare team members to assess, plan, implement, or evaluate patient care plans.', answer: 'human', counted: true, fact: { key: 'today.aiOrMe.fact.human', params: { hours: 3.5 } } },
  ],
};

const aiOrMePlayed: AiOrMeRoundFull = { ...aiOrMeRound, completed: { correct: [true, true, false, true, true], right: 4, total: 5 } };

const at = (q: string): [number, number] => {
  const s = repDocument.indexOf(q);
  return [s, s + q.length];
};

const slipBase: RepView = {
  id: 'Fx0slipDemo001',
  type: 'slip',
  kind: 'daily',
  status: 'open',
  source: 'live',
  title: 'Discharge summary',
  brief: 'A discharge summary for a 74-year-old patient going home after pneumonia, drafted from the chart.',
  taskId: '1850',
  taskText: choiceTasks.slip.taskText,
  taskShort: 'Patient education',
  occupationCode: '29-1141.00',
  locale: 'en',
  notes: [],
  difficulty: 2,
  day,
  docType: 'discharge summary',
  slip: { document: repDocument, errorCount: repErrors.length },
};

export const slipOpen: RepView = slipBase;

export const slipDone: RepView = {
  ...slipBase,
  status: 'done',
  result: {
    score: 0.67,
    found: 2,
    total: 3,
    falseFlags: 1,
    flags: [],
    ranges: [at(repErrors[0].quote), at(repErrors[1].quote), at('no fever since 8 November')],
    errorsFound: [true, true, false],
    falseRanges: [at('no fever since 8 November')],
    points: 0,
    scoreChange: { before: 62, after: 64 },
  },
  reveal: { errors: repErrors },
};

const trialDone: RepView = { ...slipDone, id: 'Fx0slipTrial01', kind: 'trial' };
const trialOpen: RepView = { ...slipBase, id: 'Fx0slipTrial01', kind: 'trial' };

const tomorrow: ChoiceTask = { ...choiceTasks.delegate };

const proBase: TodayPro = {
  day,
  daily: null,
  extras: [],
  extrasLeft: 3,
  choices: ['slip', 'delegate', 'edge'],
  nextKind: 'daily',
  choiceTasks,
  streak,
  aiOrMe: aiOrMeRound,
  tomorrow,
};

const free = (trial: Extract<Hub, { kind: 'free' }>['data']['trial'], round = aiOrMeRound): Hub => ({
  kind: 'free',
  data: { trial, aiOrMe: round, hasXray: true, tomorrow, streak: { ...streak, current: 0 } },
});

export const todayFixtures: Record<string, TodayFixture> = {
  /** Pro, nothing done today: three choice cards and AI or me under them. */
  'pro-choose': { hub: { kind: 'pro', data: proBase } },
  /** Pro, today's rep started and left open. */
  'pro-open': { hub: { kind: 'pro', data: { ...proBase, daily: slipOpen, nextKind: 'extra' } } },
  /** Pro, today's rep done: result of the day, countdown, practice reps, a played round. */
  'pro-done': { hub: { kind: 'pro', data: { ...proBase, daily: slipDone, nextKind: 'extra', extrasLeft: 3, streak: { ...streak, current: 3, lastDay: day, days: [...streak.days, day] }, aiOrMe: aiOrMePlayed } } },
  /** The rep is being written (status: generating). */
  generating: { hub: { kind: 'pro', data: proBase }, view: { v: 'generating', repId: null, type: 'slip', taskShort: 'Patient education' } },
  /** Spot the slip while highlighting. */
  'slip-answer': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: slipOpen, fresh: false } },
  /** Spot the slip after checking: marks on the margin, 2 of 3 caught, score 62 → 64. */
  'slip-review': { hub: { kind: 'pro', data: { ...proBase, streak: { ...streak, current: 3, lastDay: day, days: [...streak.days, day] } } }, view: { v: 'rep', rep: slipDone, fresh: true } },
  /** A bank rep that replaced a Delegate: shown with its source caption, no error. */
  'slip-bank': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: { ...slipOpen, source: 'bank', notes: ['type_swapped', 'english_only'] }, fresh: false } },
  /** Free with the free rep available. */
  'free-available': { hub: free({ status: 'available' }) },
  /** Free with the free rep started. */
  'free-progress': { hub: free({ status: 'in_progress', repId: trialOpen.id, rep: trialOpen }) },
  /** Free after the free rep: tomorrow's rep behind the Pro seal, AI or me already played. */
  'free-used': { hub: free({ status: 'used', repId: trialDone.id, rep: trialDone }, aiOrMePlayed) },
  /** No week map yet. */
  'no-map': { hub: { kind: 'noMap' } },
};
