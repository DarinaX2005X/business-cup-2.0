/*
 * Today screen states in the exact shapes of the reps API (03.1), for the state gallery and for
 * development (`/today?fixture=<name>`, ignored in production). Task texts and the AI-or-me round were
 * taken from a live response for a Registered Nurse week; the slip document is the kit's gallery sheet.
 */

import { repDocument, repErrors } from '@/components/kit/__fixtures__/rep';
import type { AiOrMeRoundFull, RepView } from '@/domain/reps';
import type { ChoiceTask, Hub, Streak, TodayPro } from '../api';
import type { TodayFixture } from '../TodayScreen';
import delegateGradedJson from './delegate-graded.json';
import edgeGradedJson from './edge-graded.json';

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
    falseFlags: 2,
    flags: [],
    ranges: [at('6 Nov 2026'), at(repErrors[0].quote), at(repErrors[1].quote), at('no fever since 8 November')],
    errorsFound: [true, true, false],
    // the first stray highlight sits in a table cell, so its margin note must line up with that row
    falseRanges: [at('6 Nov 2026'), at('no fever since 8 November')],
    points: 0,
    scoreChange: { before: 62, after: 64, from: 62, to: 64, fromExact: 62.3, toExact: 63.9 },
  },
  reveal: { errors: repErrors },
};

const trialDone: RepView = { ...slipDone, id: 'Fx0slipTrial01', kind: 'trial' };
const trialOpen: RepView = { ...slipBase, id: 'Fx0slipTrial01', kind: 'trial' };

const tomorrow: ChoiceTask = { ...choiceTasks.delegate };

/*
 * Delegate and Human edge: real graded reps from a live run (a med-surg handoff and a talk with a
 * nursing assistant), with the open steps derived from them. The graded Delegate also carries the
 * engine's newer fields (the fix sentence, an exemplar instruction, one trap the AI flagged itself),
 * and the graded talk one harmful line, so their states can be seen before every rep has them.
 */
const delegateGraded = delegateGradedJson as unknown as RepView;
const edgeGraded = edgeGradedJson as unknown as RepView;
const exactChange = { before: 85, after: 85, from: 85, to: 85, fromExact: 84.6, toExact: 85.1 };

const delegateOpen: RepView = {
  ...delegateGraded,
  id: 'Fx0delegateOpn',
  status: 'open',
  delegate: { ...delegateGraded.delegate!, instruction: undefined, run: undefined, review: undefined },
  result: undefined,
  reveal: undefined,
};
const delegateRun: RepView = { ...delegateOpen, id: 'Fx0delegateRun', delegate: { ...delegateGraded.delegate!, review: undefined } };
const delegateDone: RepView = {
  ...delegateGraded,
  delegate: { ...delegateGraded.delegate!, review: { ranges: [], fix: 'Hold the 20:00 ciprofloxacin and call the provider: she reacted to it at 14:15.' } },
  result: { ...delegateGraded.result!, scoreChange: exactChange, trapsCaught: [], trapsCaughtByAi: [delegateGraded.reveal?.traps?.[1]?.id ?? 't2'] },
  reveal: {
    ...delegateGraded.reveal,
    exemplar:
      'Write an SBAR handoff for the night-shift RN taking over at 19:00, under 300 words. Before you write, check every ordered medication against the allergy notes and the chart, and flag any conflict at the top. Compare the two sets of vitals and call out any sudden change that needs the provider tonight. Keep the abnormal labs and the next scheduled doses.',
  },
};

const edgeOpen: RepView = {
  ...edgeGraded,
  id: 'Fx0edgeOpen001',
  status: 'open',
  edge: { ...edgeGraded.edge!, turns: edgeGraded.edge!.turns.slice(0, 3), repliesLeft: 5 },
  result: undefined,
  reveal: undefined,
};
const edgeDone: RepView = {
  ...edgeGraded,
  result: { ...edgeGraded.result!, scoreChange: exactChange, harm: { quote: 'Can you have it done by 2:45' /* the second reply: a deadline for someone who just said he is overwhelmed */, why: 'He has just told you he cannot keep up. A deadline at this moment sounds like pressure, not help, and he may stop telling you the real problem.' } },
};

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
  /** Delegate: writing the instructions. */
  'delegate-open': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: delegateOpen, fresh: false } },
  /** Delegate: the AI's result, to mark and fix. */
  'delegate-run': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: delegateRun, fresh: false } },
  /** Delegate graded: what the instructions covered, the traps, the exemplar, the exact score step. */
  'delegate-graded': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: delegateDone, fresh: true } },
  /** Human edge: the talk under way. */
  'edge-open': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: edgeOpen, fresh: false } },
  /** Human edge graded: notes beside the replies, a harmful line, what they didn't say. */
  'edge-graded': { hub: { kind: 'pro', data: proBase }, view: { v: 'rep', rep: edgeDone, fresh: true } },
  /** No week map yet. */
  'no-map': { hub: { kind: 'noMap' } },
};
