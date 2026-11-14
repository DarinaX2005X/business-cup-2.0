import {
  applyStreak,
  delegateScore,
  edgeScore,
  gradeSlip,
  localDay,
  mergeRanges,
  streakAsOf,
  trapSpots,
  trapsCaught,
  type Range,
  type RepFlag,
  type RepRecord,
  type RepResultFull,
  type RepRevealFull,
  type RepView,
} from '@/domain/reps';
import { computeXray } from '@/domain/xray';
import type { PointsAward, Profile, ProofEntry } from '@/domain/types';
import type { AiErrorCode } from '@/server/ai/client';
import { isAiError } from '@/server/ai/client';
import { emit } from '@/server/events';
import { getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { loadBundle, practiceOf, readXray } from '@/server/xray';
import { edgeReply, gradeDelegate, gradeEdge, runDelegate } from './generate';
import { MAX_EDGE_REPLIES, readRep, repKey, taskCaption, toView } from './records';
import { innerActorOf, nowOf, tzOf, type RepCtx } from './service';

/**
 * POST /api/reps/:id/answer by type. Grading is code (slip) or rubric + code checks (delegate, edge).
 * Completion: the rep is written as done with a compare-and-set on its version (a second answer gets
 * 409), then one profile update records the score in repLog, the proof entry, the streak (daily and
 * trial) and emits rep_completed. That profile step is idempotent and is repeated if a done rep is
 * found without its score.
 */

export type AnswerBody =
  | { ranges: Range[] }
  | { step: 'instruction'; instruction: string }
  | { step: 'review'; ranges: Range[]; fix: string }
  | { message: string }
  | { finish: true };

export interface AnswerResult {
  rep: RepView;
  pointsAwarded: PointsAward[];
  streak: Profile['streak'];
}

/** Model failures after which waiting will not help today: grade what exists instead of failing. */
const HARD_STOP: AiErrorCode[] = ['budget_exceeded', 'rate_limited'];

async function load(ctx: RepCtx, id: string): Promise<{ rep: RepRecord; version: number }> {
  if (!ctx.profile.reps.includes(id)) throw new HttpError(404, 'not_found', 'Rep not found.');
  const hit = await readRep(id);
  if (!hit || hit.rep.profileId !== ctx.profile.id) throw new HttpError(404, 'not_found', 'Rep not found.');
  return hit;
}

async function save(rep: RepRecord, version: number): Promise<number> {
  try {
    return await getStore().set(repKey(rep.id), rep, { version });
  } catch (err) {
    if (isConflictError(err)) throw new HttpError(409, 'conflict', 'This rep was answered in another tab; reload it.');
    throw err;
  }
}

const streakNow = (ctx: RepCtx, p: Profile) => streakAsOf(p.streak, localDay(nowOf(ctx), tzOf(ctx)));

/** Score of the latest week map with the given practice (null without a map). */
async function mapScore(profile: Profile, practice: { n: number; avgScore: number }): Promise<number | null> {
  if (!profile.lastXrayId) return null;
  const xray = await readXray(profile.lastXrayId);
  if (!xray) return null;
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle) return xray.score;
  return computeXray(bundle, xray.shares, { salary: profile.salary ?? null, practice }).result.score;
}

async function scoreChange(profile: Profile, repId: string, score: number): Promise<{ before: number; after: number }> {
  const before = practiceOf(profile);
  const after = practiceOf({ repLog: profile.repLog.map((r) => (r.id === repId ? { ...r, score } : r)) });
  const [b, a] = await Promise.all([mapScore(profile, before), mapScore(profile, after)]);
  return { before: b ?? 0, after: a ?? b ?? 0 };
}

async function proofFor(rep: RepRecord, result: RepResultFull, locale: Profile['locale']): Promise<Pick<ProofEntry, 'summaryKey' | 'summaryParams'>> {
  const { short } = await taskCaption(rep.occupationCode, rep.taskId, locale);
  if (rep.type === 'slip') return { summaryKey: 'proof.slip', summaryParams: { found: result.found ?? 0, total: result.total ?? 0, doc: rep.docType ?? rep.title } };
  const met = (result.criteria ?? []).filter((c) => c.status === 'met').length;
  const criteria = result.criteria?.length ?? 0;
  if (rep.type === 'delegate') {
    return {
      summaryKey: 'proof.delegate',
      summaryParams: { met, criteria, traps: result.trapsCaught?.length ?? 0, trapsTotal: rep.delegate?.traps.length ?? 0, task: short },
    };
  }
  return { summaryKey: 'proof.edge', summaryParams: { met, criteria, task: short } };
}

/** Records a done rep in the profile (once): repLog score, proof, streak, trial, rep_completed. */
async function finalizeProfile(ctx: RepCtx, rep: RepRecord): Promise<{ awards: PointsAward[]; profile: Profile }> {
  const result = rep.result!;
  const proof = await proofFor(rep, result, ctx.profile.locale);
  const day = localDay(nowOf(ctx), tzOf(ctx));
  const { awards, profile } = await updateProfile(ctx.profile.id, (p) => {
    const entry = p.repLog.find((r) => r.id === rep.id);
    if (entry && typeof entry.score === 'number') return; // already recorded
    if (entry) Object.assign(entry, { score: result.score, taskId: rep.taskId, type: rep.type });
    else p.repLog.push({ id: rep.id, taskId: rep.taskId, type: rep.type, kind: rep.kind, day: rep.day, score: result.score });
    if (!p.proof.some((e) => e.repId === rep.id)) {
      p.proof.push({
        id: `pf_${rep.id}`,
        repId: rep.id,
        type: rep.type,
        taskId: rep.taskId,
        occupationCode: rep.occupationCode,
        score: result.score,
        ...proof,
        at: rep.completedAt ?? new Date().toISOString(),
        public: false,
      });
    }
    if (rep.kind === 'daily' || rep.kind === 'trial') p.streak = applyStreak(p.streak, day);
    if (rep.kind === 'trial') p.trial = { status: 'used', repId: rep.id };
    return emit(p, { type: 'rep_completed', ref: rep.id, data: { score: result.score, type: rep.type, kind: rep.kind } });
  });
  return { awards, profile };
}

async function complete(ctx: RepCtx, rep: RepRecord, version: number, result: Omit<RepResultFull, 'points' | 'scoreChange'>, reveal: RepRevealFull): Promise<AnswerResult> {
  const done: RepRecord = {
    ...rep,
    status: 'done',
    completedAt: new Date().toISOString(),
    result: { ...result, points: 0, scoreChange: await scoreChange(ctx.profile, rep.id, result.score) },
    reveal,
  };
  const v = await save(done, version);
  const { awards, profile } = await finalizeProfile(ctx, done);
  if (awards.length) {
    done.result!.points = awards.reduce((n, a) => n + a.points, 0);
    await getStore().set(repKey(done.id), done, { version: v }).catch(() => undefined);
  }
  return { rep: await toView(done, ctx.profile.locale), pointsAwarded: awards, streak: streakNow(ctx, profile) };
}

async function progress(ctx: RepCtx, rep: RepRecord, version: number): Promise<AnswerResult> {
  await save(rep, version);
  return { rep: await toView(rep, ctx.profile.locale), pointsAwarded: [], streak: streakNow(ctx, ctx.profile) };
}

// ---------------------------------------------------------------------------------------------

export async function answerRep(ctx: RepCtx, id: string, body: AnswerBody): Promise<AnswerResult> {
  const { rep, version } = await load(ctx, id);
  if (rep.status === 'done') {
    // Repair a completion whose profile step did not run, then refuse the repeat.
    const entry = ctx.profile.repLog.find((r) => r.id === id);
    if (rep.result && (!entry || typeof entry.score !== 'number')) await finalizeProfile(ctx, rep).catch(() => undefined);
    const fresh = (await getProfile(ctx.profile.id)) ?? ctx.profile;
    throw new HttpError(409, 'already_done', 'This rep is already checked.', { rep: await toView(rep, ctx.profile.locale), streak: streakNow(ctx, fresh) });
  }
  if (rep.type === 'slip') return answerSlip(ctx, rep, version, body);
  if (rep.type === 'delegate') return answerDelegate(ctx, rep, version, body);
  return answerEdge(ctx, rep, version, body);
}

function answerSlip(ctx: RepCtx, rep: RepRecord, version: number, body: AnswerBody) {
  if (!('ranges' in body) || 'step' in body) throw new HttpError(400, 'invalid_input', 'ranges: required for Spot the slip');
  const slip = rep.slip!;
  const g = gradeSlip(slip.errors, body.ranges, slip.document.length);
  return complete(
    ctx,
    rep,
    version,
    { score: g.score, found: g.found, total: g.total, falseFlags: g.falseFlags, flags: g.flags, ranges: g.ranges, errorsFound: g.errorsFound, falseRanges: g.falseRanges },
    { errors: slip.errors },
  );
}

async function answerDelegate(ctx: RepCtx, rep: RepRecord, version: number, body: AnswerBody): Promise<AnswerResult> {
  const d = rep.delegate!;
  if (!('step' in body)) throw new HttpError(400, 'invalid_input', 'step: "instruction" or "review"');
  if (body.step === 'instruction') {
    if (d.run !== undefined) throw new HttpError(409, 'already_run', 'The AI already ran this instruction; review its result.');
    const instruction = body.instruction.trim();
    try {
      const { output } = await runDelegate({ inputs: d.inputs, instruction, locale: rep.locale, actor: innerActorOf(ctx) });
      return progress(ctx, { ...rep, delegate: { ...d, instruction, run: output } }, version);
    } catch (err) {
      if (!isAiError(err)) throw err;
      if (!HARD_STOP.includes(err.code)) {
        // keep the instruction so the screen can offer "Run again" with it
        await save({ ...rep, delegate: { ...d, instruction } }, version).catch(() => undefined);
        throw err;
      }
      // No model today: grade the instruction itself (keywords), traps by the instruction only.
      const graded = await gradeDelegate({ occupation: '', locale: rep.locale, scenario: d.scenario, goal: d.goal, inputs: d.inputs, criteria: d.criteria, traps: d.traps, instruction, run: '', highlighted: [], fix: '' });
      const caught = trapsCaught(d.traps, instruction, '', [], d.inputs, '', graded.trapsNamed);
      const flags: RepFlag[] = ['ended_early', ...(graded.keywordGrade ? (['keyword_grade'] as const) : [])];
      return complete(
        ctx,
        { ...rep, delegate: { ...d, instruction } },
        version,
        { score: delegateScore(graded.criteria, caught.length, d.traps.length), criteria: graded.criteria, trapsCaught: caught, flags, ...(graded.summary ? { summary: graded.summary } : {}) },
        { traps: d.traps, trapSpots: trapSpots(d.traps, d.inputs, undefined) },
      );
    }
  }
  if (d.run === undefined || d.instruction === undefined) throw new HttpError(409, 'not_run', 'Run your instruction first.');
  const ranges = mergeRanges(body.ranges, d.run.length, 12);
  const fix = body.fix.trim();
  const bundle = await loadBundle(rep.occupationCode);
  const graded = await gradeDelegate({
    occupation: bundle?.title ?? '',
    locale: rep.locale,
    scenario: d.scenario,
    goal: d.goal,
    inputs: d.inputs,
    criteria: d.criteria,
    traps: d.traps,
    instruction: d.instruction,
    run: d.run,
    highlighted: ranges.map(([a, b]) => d.run!.slice(a, b)),
    fix,
    actor: innerActorOf(ctx),
  });
  const caught = trapsCaught(d.traps, d.instruction, d.run, ranges, d.inputs, fix, graded.trapsNamed);
  return complete(
    ctx,
    { ...rep, delegate: { ...d, review: { ranges, fix } } },
    version,
    {
      score: delegateScore(graded.criteria, caught.length, d.traps.length),
      criteria: graded.criteria,
      trapsCaught: caught,
      flags: graded.keywordGrade ? ['keyword_grade'] : [],
      ...(graded.summary ? { summary: graded.summary } : {}),
      ...(graded.fixFeedback ? { fixFeedback: graded.fixFeedback } : {}),
    },
    { traps: d.traps, trapSpots: trapSpots(d.traps, d.inputs, d.run) },
  );
}

async function answerEdge(ctx: RepCtx, rep: RepRecord, version: number, body: AnswerBody): Promise<AnswerResult> {
  const e = rep.edge!;
  const bundle = await loadBundle(rep.occupationCode);
  const occupation = bundle?.title ?? '';
  const userTurns = e.turns.filter((t) => t.role === 'user').length;
  const grade = async (turns: typeof e.turns, endedEarly: boolean, extra: Partial<typeof e> = {}) => {
    const graded = await gradeEdge({
      occupation,
      locale: rep.locale,
      scenario: e.scenario,
      personaPublic: e.personaPublic,
      personaHidden: e.personaHidden,
      goal: e.goal,
      criteria: e.criteria,
      turns,
      endedEarly,
      actor: innerActorOf(ctx),
    });
    return { graded, extra };
  };
  const finish = (turns: typeof e.turns, graded: Awaited<ReturnType<typeof gradeEdge>>, endedEarly: boolean) => {
    const flags: RepFlag[] = [...(endedEarly ? (['ended_early'] as const) : []), ...(graded.keywordGrade ? (['keyword_grade'] as const) : [])];
    return complete(
      ctx,
      { ...rep, edge: { ...e, turns } },
      version,
      { score: edgeScore(graded.criteria), criteria: graded.criteria, flags, ...(graded.summary ? { summary: graded.summary } : {}) },
      { personaHidden: e.personaHidden },
    );
  };

  if ('finish' in body) {
    if (userTurns === 0) throw new HttpError(400, 'nothing_to_grade', 'Reply at least once before finishing.');
    const { graded } = await grade(e.turns, false);
    return finish(e.turns, graded, false);
  }
  if (!('message' in body)) throw new HttpError(400, 'invalid_input', 'message or finish: required for Human edge');
  if (userTurns >= MAX_EDGE_REPLIES) throw new HttpError(409, 'no_replies_left', 'All six replies are used; finish to get feedback.');
  const turns = [...e.turns, { role: 'user' as const, text: body.message.trim() }];
  const replyInput = { occupation, locale: rep.locale, scenario: e.scenario, personaPublic: e.personaPublic, personaHidden: e.personaHidden, turns, actor: innerActorOf(ctx) };

  if (userTurns + 1 >= MAX_EDGE_REPLIES) {
    // last reply: the persona answers and the grade runs at the same time
    const [reply, { graded }] = await Promise.all([edgeReply(replyInput).catch(() => null), grade(turns, false)]);
    return finish(reply ? [...turns, { role: 'persona', text: reply.reply }] : turns, graded, false);
  }
  try {
    const reply = await edgeReply(replyInput);
    return progress(ctx, { ...rep, edge: { ...e, turns: [...turns, { role: 'persona', text: reply.reply }] } }, version);
  } catch (err) {
    if (!isAiError(err) || !HARD_STOP.includes(err.code)) throw err;
    // The model is out for today: grade what was said.
    const { graded } = await grade(turns, true);
    return finish(turns, graded, true);
  }
}
