import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Range, RepView } from '@/domain/reps';
import type { Profile } from '@/domain/types';
import { POINT_RULES, REP_POINTS, repPoints } from '@/domain/points';
import { AiError } from '@/server/ai/client';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { aiOrMeFor, answerRep, createRep, getRep, getToday, logWork, readBank, resetBankCache, startTrial, submitAiOrMe, weekOf, type RepCtx } from '@/server/reps';
import { MAX_EXTRAS_PER_DAY, retryRep } from '@/server/reps/service';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { useTempStore } from '../platform/helpers';
import { nurseEdge, nurseSlip, writeBank } from './fixtures';

/**
 * The engine with the writers stubbed: every rep is "written live" from the person's own occupation and
 * task (the stub echoes them), and a failing writer gives an honest generation_failed with a same-id retry.
 * AI_BUDGET_USD=0 keeps every other model call (Edge replies, grading) offline: they fail with
 * budget_exceeded, which exercises the graded-on-what-was-said path. The rep bank is never read.
 */

const gen = vi.hoisted(() => ({ fail: null as null | 'budget_exceeded' | 'provider_error' | 'invalid_output', calls: [] as { type: string; occupationCode: string; taskId: string }[] }));

vi.mock('@/server/reps/generate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/reps/generate')>();
  const { nurseSlip: slip, nurseEdge: edge } = await import('./fixtures');
  const stub = (type: 'slip' | 'edge' | 'delegate') =>
    vi.fn(async (input: { occupationCode: string; taskId: string }) => {
      gen.calls.push({ type, occupationCode: input.occupationCode, taskId: input.taskId });
      if (gen.fail) throw new AiError(gen.fail, `stubbed ${gen.fail}`, { op: `rep.${type}` });
      const base = type === 'edge' ? edge(input.taskId) : slip(input.taskId);
      if (type === 'delegate') throw new AiError('invalid_output', 'no delegate stub', { op: 'rep.delegate' });
      return { entry: { ...base, occupationCode: input.occupationCode, taskId: input.taskId }, attempts: 1, costUsd: 0, rejected: [] };
    });
  return { ...real, generateSlip: stub('slip'), generateEdge: stub('edge'), generateDelegate: stub('delegate') };
});

const NURSE = '29-1141.00';
const DEV = '15-1252.00';
const env = { ...process.env };
let bankDir: string;
let cleanup: () => void;

beforeAll(() => {
  bankDir = mkdtempSync(path.join(tmpdir(), 'irr-bank-'));
  Object.assign(process.env, { REP_BANK_DIR: bankDir, OPENROUTER_API_KEY: 'test-key', AI_BUDGET_USD: '0', DEV_FORCE_PRO: '1' });
});
afterAll(() => {
  process.env = env;
  rmSync(bankDir, { recursive: true, force: true });
});
beforeEach(async () => {
  ({ cleanup } = useTempStore());
  gen.fail = null;
  gen.calls = [];
  // a full bank for the nurse: it must never be served
  rmSync(bankDir, { recursive: true, force: true });
  const week = typicalWeek((await loadBundle(NURSE))!).shares;
  writeBank(bankDir, [nurseSlip(week[0].taskId), nurseEdge(week[1].taskId)]);
  resetBankCache();
});
afterEach(() => cleanup());

async function profileFor(code: string, jobTitle: string): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  const bundle = (await loadBundle(code))!;
  await createXray({ profile, occupationCode: code, shares: typicalWeek(bundle).shares, jobTitle, inputSource: 'title' });
  return (await getProfile(profile.id))!;
}
const nurse = () => profileFor(NURSE, 'RN');

const at = (iso: string) => new Date(iso);
async function ctx(id: string, now: string, extra: Partial<RepCtx> = {}): Promise<RepCtx> {
  return { profile: (await getProfile(id))!, headerTz: 'America/Chicago', now: at(now), ...extra };
}
const exactRanges = (rep: RepView, all = true): Range[] => {
  // the client never sees the errors; tests read them from the stub's fixture
  const slip = nurseSlip('x').slip;
  expect(rep.slip?.document).toBe(slip.document);
  return slip.errors.slice(0, all ? 3 : 1).map((e) => [e.start, e.end]);
};
async function expectHttp(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  expect((err as HttpError).code).toBe(code);
  return err as HttpError;
}

describe('reps are written live', () => {
  it('a daily slip is written for the person, graded exactly and recorded once', async () => {
    const p = await nurse();
    const made = await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' });
    const rep = (made as { rep: RepView }).rep;
    expect(rep).toMatchObject({ source: 'live', status: 'open', notes: [], occupationCode: NURSE, slip: { errorCount: 3 } });
    expect(rep).not.toHaveProperty('reveal');

    await expectHttp(createRep(await ctx(p.id, '2026-11-14T16:00:00Z'), { type: 'slip', kind: 'daily' }), 409, 'daily_exists');

    const done = await answerRep(await ctx(p.id, '2026-11-14T16:00:00Z'), rep.id, { ranges: exactRanges(rep) });
    // points (stage 04) come from the rule table: daily rep at score 1, perfect, first rep
    const award = (type: string, ruleId: string, points: number) => ({ type, points, labelKey: POINT_RULES.find((r) => r.id === ruleId)!.labelKey });
    const expected = [award('rep_completed', 'rep_daily', repPoints('daily', 1)), award('rep_perfect', 'rep_perfect', REP_POINTS.perfect), award('first_rep', 'first_rep', REP_POINTS.first)];
    expect(done.rep.result).toMatchObject({ score: 1, found: 3, total: 3, falseFlags: 0, points: expected.reduce((n, a) => n + a.points, 0) });
    expect(done.rep.result!.scoreChange.toExact).toBeGreaterThan(done.rep.result!.scoreChange.fromExact);
    expect(done.pointsAwarded).toEqual(expected);
    expect(done.streak.current).toBe(1);
    const after = (await getProfile(p.id))!;
    expect(after.repLog.find((r) => r.id === rep.id)?.score).toBe(1);
    expect(after.proof).toHaveLength(1);
    await expectHttp(answerRep(await ctx(p.id, '2026-11-14T16:05:00Z'), rep.id, { ranges: [] }), 409, 'already_done');
    expect((await getProfile(p.id))!.proof).toHaveLength(1);
  });

  it('two days in a row give streak 2, a skipped day restarts at 1; extras do not count', async () => {
    const p = await nurse();
    const play = async (now: string, kind: 'daily' | 'extra' = 'daily') => {
      const made = (await createRep(await ctx(p.id, now), { type: 'slip', kind })) as { rep: RepView };
      return answerRep(await ctx(p.id, now), made.rep.id, { ranges: exactRanges(made.rep, false) });
    };
    expect((await play('2026-11-14T15:00:00Z')).streak.current).toBe(1);
    expect((await play('2026-11-15T15:00:00Z')).streak.current).toBe(2);
    expect((await play('2026-11-15T16:00:00Z', 'extra')).streak.current).toBe(2);
    const gap = await play('2026-11-17T15:00:00Z');
    expect(gap.streak).toMatchObject({ current: 1, best: 2, days: ['2026-11-14', '2026-11-15', '2026-11-17'] });
  });

  it('an edge rep whose model goes down mid-conversation is graded on what was said', async () => {
    const p = await nurse();
    const e = (await createRep(await ctx(p.id, '2026-11-14T15:10:00Z'), { type: 'edge', kind: 'extra' })) as { rep: RepView };
    expect(e.rep).toMatchObject({ type: 'edge', source: 'live' });
    expect(e.rep.edge).toMatchObject({ repliesLeft: 6, turns: [{ role: 'persona' }] });
    expect(JSON.stringify(e.rep)).not.toContain('unpaid leave'); // hidden reason stays hidden
    const r = await answerRep(await ctx(p.id, '2026-11-14T15:12:00Z'), e.rep.id, {
      message: "I understand, waiting all day is frustrating. The pharmacy is doing a final medication check. I can't promise a time, but I will check with them and come back by 5.",
    });
    expect(r.rep.status).toBe('done');
    expect(r.rep.result?.flags).toEqual(['ended_early', 'keyword_grade']);
    expect(r.rep.reveal?.personaHidden).toContain('unpaid leave');
    expect(r.streak.current).toBe(0); // an extra does not start the streak
  });

  it('extras have a daily cap; Free users get 402 with trial, AI or me and tomorrow', async () => {
    const p = await nurse();
    for (let i = 0; i < MAX_EXTRAS_PER_DAY; i++) await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'extra' });
    await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'extra' }), 429, 'extra_limit');
    process.env.DEV_FORCE_PRO = '0';
    try {
      const err = await expectHttp(getToday(await ctx(p.id, '2026-11-14T15:00:00Z')), 402, 'pro_required');
      expect(err.extra).toMatchObject({ trial: { status: 'available' }, hasXray: true });
      expect(err.extra!.tomorrow).toMatchObject({ taskId: expect.any(String), taskShort: expect.any(String) });
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });

  it('today shows choices with tasks of the week and the daily once made', async () => {
    const p = await nurse();
    const t1 = await getToday(await ctx(p.id, '2026-11-14T15:00:00Z'));
    expect(t1).toMatchObject({ daily: null, nextKind: 'daily', failed: [], choices: ['slip', 'delegate', 'edge'] });
    const week = new Set(p.shares!.map((s) => s.taskId));
    for (const c of Object.values(t1.choiceTasks)) expect(week.has(c.taskId)).toBe(true);
    await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' });
    const t2 = await getToday(await ctx(p.id, '2026-11-14T15:30:00Z'));
    expect(t2.daily?.type).toBe('slip');
    expect(t2.nextKind).toBe('extra');
  });
});

describe('POST /api/reps with taskId ("Practise this")', () => {
  it("uses a task of the person's week, and ignores an id that is not in it", async () => {
    const p = await nurse();
    const week = p.shares!.map((s) => s.taskId);
    const wanted = week[week.length - 1];
    const a = (await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'extra', taskId: wanted })) as { rep: RepView };
    expect(a.rep.taskId).toBe(wanted);
    const devTask = (await loadBundle(DEV))!.tasks[0].id; // a real task, but of another job
    for (const taskId of [devTask, 'nope', '']) {
      const r = (await createRep(await ctx(p.id, '2026-11-14T15:01:00Z'), { type: 'slip', kind: 'extra', taskId })) as { rep: RepView };
      expect(week).toContain(r.rep.taskId);
    }
  });
});

describe('no prepared content: an honest error and a same-id retry', () => {
  for (const code of ['budget_exceeded', 'provider_error', 'invalid_output'] as const) {
    it(`on ${code} the daily fails honestly, keeps its id, and "Try again" rewrites it live`, async () => {
      const p = await nurse();
      gen.fail = code;
      const err = await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' }), 503, 'generation_failed');
      const repId = err.extra!.repId as string;
      expect(err.extra).toMatchObject({ retryable: true, reason: code });
      // nothing was served from the bank, and the failed rep reads as failed under its id
      await expectHttp(getRep(await ctx(p.id, '2026-11-14T15:01:00Z'), repId), 503, 'generation_failed');
      const today = await getToday(await ctx(p.id, '2026-11-14T15:01:00Z'));
      expect(today).toMatchObject({ daily: null, nextKind: 'daily', failed: [{ repId, kind: 'daily' }] });

      gen.fail = null;
      // the UI's "Try again" posts the same daily again: same id, written live
      const again = (await createRep(await ctx(p.id, '2026-11-14T15:02:00Z'), { type: 'slip', kind: 'daily' })) as { rep: RepView };
      expect(again.rep).toMatchObject({ id: repId, source: 'live', notes: [] });
      // or explicitly through POST /api/reps/:id/retry once it exists
      expect((await retryRep(await ctx(p.id, '2026-11-14T15:03:00Z'), repId)) as { rep: RepView }).toMatchObject({ rep: { id: repId } });
      expect((await getProfile(p.id))!.repLog.filter((r) => r.kind === 'daily')).toHaveLength(1);
    });
  }

  it('a failing delegate never turns into another rep type', async () => {
    const p = await nurse();
    const err = await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'delegate', kind: 'daily' }), 503, 'generation_failed');
    expect(gen.calls.map((c) => c.type)).toEqual(['delegate']);
    expect(err.extra).toMatchObject({ retryable: true });
  });

  it('the trial is written live too, is idempotent until completed, then 409 trial_used', async () => {
    process.env.DEV_FORCE_PRO = '0';
    try {
      const p = await nurse();
      gen.fail = 'provider_error';
      const err = await expectHttp(startTrial(await ctx(p.id, '2026-11-14T15:00:00Z')), 503, 'generation_failed');
      gen.fail = null;
      const a = (await startTrial(await ctx(p.id, '2026-11-14T15:01:00Z'))) as { rep: RepView };
      expect(a.rep).toMatchObject({ id: err.extra!.repId, kind: 'trial', source: 'live', type: 'slip', notes: [] });
      const b = (await startTrial(await ctx(p.id, '2026-11-14T15:05:00Z'))) as { rep: RepView };
      expect(b.rep.id).toBe(a.rep.id);
      const done = await answerRep(await ctx(p.id, '2026-11-14T15:10:00Z'), a.rep.id, { ranges: exactRanges(a.rep) });
      expect(done.streak.current).toBe(1);
      expect((await getProfile(p.id))!.trial).toEqual({ status: 'used', repId: a.rep.id });
      await expectHttp(startTrial(await ctx(p.id, '2026-11-15T15:00:00Z')), 409, 'trial_used');
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });

  it('the bank reader still skips landing showcase entries (static illustrations only)', async () => {
    const week = typicalWeek((await loadBundle(NURSE))!).shares;
    writeBank(bankDir, [nurseSlip(week[0].taskId), nurseSlip(week[1].taskId)]);
    writeFileSync(path.join(bankDir, 'showcase.json'), JSON.stringify([`${NURSE}/slip-1.json`]));
    resetBankCache();
    expect((await readBank(NURSE, 'slip', 'en')).map((i) => i.file)).toEqual([`${NURSE}/slip-2.json`]);
  });
});

describe('a new map for another job', () => {
  const remap = async (id: string, code: string, title: string) => {
    const b = (await loadBundle(code))!;
    await createXray({ profile: (await getProfile(id))!, occupationCode: code, shares: typicalWeek(b).shares, jobTitle: title, inputSource: 'resume' });
    return b;
  };

  it('reps of the earlier job are not shown as today\'s, but still count: no second daily, new reps use the new job', async () => {
    const p = await nurse();
    const first = (await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' })) as { rep: RepView };
    expect(first.rep.occupationCode).toBe(NURSE);
    const dev = await remap(p.id, DEV, 'Software Engineer');
    const today = await getToday(await ctx(p.id, '2026-11-14T16:00:00Z'));
    expect(today.daily).toBeNull(); // the nurse daily is hidden…
    expect(today.nextKind).toBe('extra'); // …but today's daily is used
    await expectHttp(createRep(await ctx(p.id, '2026-11-14T16:01:00Z'), { type: 'edge', kind: 'daily' }), 409, 'daily_exists');
    const devTasks = new Set(dev.tasks.map((t) => t.id));
    for (const c of Object.values(today.choiceTasks)) expect(devTasks.has(c.taskId)).toBe(true);
    const edge = (await createRep(await ctx(p.id, '2026-11-14T16:02:00Z'), { type: 'edge', kind: 'extra' })) as { rep: RepView };
    expect(edge.rep.occupationCode).toBe(DEV);
    expect(devTasks.has(edge.rep.taskId)).toBe(true);
  });

  it('switching jobs does not reset the extra cap or the daily points', async () => {
    const p = await nurse();
    const daily = (await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' })) as { rep: RepView };
    const paid = await answerRep(await ctx(p.id, '2026-11-14T15:01:00Z'), daily.rep.id, { ranges: exactRanges(daily.rep) });
    expect(paid.pointsAwarded.some((a) => a.labelKey === POINT_RULES.find((r) => r.id === 'rep_daily')!.labelKey)).toBe(true);
    for (let i = 0; i < MAX_EXTRAS_PER_DAY - 1; i++) await createRep(await ctx(p.id, '2026-11-14T15:02:00Z'), { type: 'slip', kind: 'extra' });
    await remap(p.id, DEV, 'Software Engineer');
    // one extra left in total, not a fresh set for the new job
    expect((await getToday(await ctx(p.id, '2026-11-14T15:03:00Z'))).extrasLeft).toBe(1);
    await createRep(await ctx(p.id, '2026-11-14T15:04:00Z'), { type: 'slip', kind: 'extra' });
    await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:05:00Z'), { type: 'slip', kind: 'extra' }), 429, 'extra_limit');
    await remap(p.id, NURSE, 'RN');
    await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:06:00Z'), { type: 'slip', kind: 'daily' }), 409, 'daily_exists');
  });

  it('rep_daily points are paid once per local day', async () => {
    const { award } = await import('@/domain/points');
    const p = await nurse();
    const daily = (await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' })) as { rep: RepView };
    await answerRep(await ctx(p.id, '2026-11-14T15:01:00Z'), daily.rep.id, { ranges: exactRanges(daily.rep) });
    // a second daily-kind completion the same day (e.g. after a job switch) earns no rep_daily
    const fresh = (await getProfile(p.id))!;
    fresh.repLog.push({ id: 'second-daily', taskId: fresh.repLog[0].taskId, type: 'slip', kind: 'daily', day: '2026-11-14', score: 1 });
    const res = award(fresh, { type: 'rep_completed', ref: 'second-daily', data: { score: 1, type: 'slip', kind: 'daily' }, at: '2026-11-14T15:30:00.000Z' });
    expect(res.awards.map((a) => a.labelKey)).not.toContain(POINT_RULES.find((r) => r.id === 'rep_daily')!.labelKey);
  });

  it('a delivered, unanswered trial is rewritten for a new job once; after that the trial is used', async () => {
    process.env.DEV_FORCE_PRO = '0';
    try {
      const p = await nurse();
      const t = (await startTrial(await ctx(p.id, '2026-11-14T15:00:00Z'))) as { rep: RepView };
      await remap(p.id, DEV, 'Software Engineer');
      const again = (await startTrial(await ctx(p.id, '2026-11-14T15:30:00Z'))) as { rep: RepView };
      expect(again.rep).toMatchObject({ id: t.rep.id, occupationCode: DEV });
      expect((await getProfile(p.id))!.trial).toMatchObject({ status: 'in_progress', rewrites: 1 });
      // the same job again returns the same rep, no new rewrite
      expect(((await startTrial(await ctx(p.id, '2026-11-14T15:31:00Z'))) as { rep: RepView }).rep.id).toBe(t.rep.id);
      await remap(p.id, '13-2011.00', 'Staff Accountant');
      const calls = gen.calls.length;
      await expectHttp(startTrial(await ctx(p.id, '2026-11-14T16:00:00Z')), 409, 'trial_used');
      expect(gen.calls.length).toBe(calls); // nothing was written
      // the delivered trial can still be answered
      expect((await getRep(await ctx(p.id, '2026-11-14T16:01:00Z'), t.rep.id)) as { rep: RepView }).toMatchObject({ rep: { occupationCode: DEV } });
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });

  it('an answered trial is used for good, whatever the job', async () => {
    process.env.DEV_FORCE_PRO = '0';
    try {
      const p = await nurse();
      const t = (await startTrial(await ctx(p.id, '2026-11-14T15:00:00Z'))) as { rep: RepView };
      await answerRep(await ctx(p.id, '2026-11-14T15:01:00Z'), t.rep.id, { ranges: exactRanges(t.rep) });
      await remap(p.id, DEV, 'Software Engineer');
      await expectHttp(startTrial(await ctx(p.id, '2026-11-14T15:30:00Z')), 409, 'trial_used');
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });
});

describe('AI or me and work log', () => {
  it('one round a day: same on reopening, new tomorrow, a second POST is 409', async () => {
    const p = await nurse();
    const week = (await weekOf(p))!;
    const r1 = await aiOrMeFor(p, week, '2026-11-14');
    expect(await aiOrMeFor(p, week, '2026-11-14')).toEqual(r1);
    expect((await aiOrMeFor(p, week, '2026-11-15')).roundId).not.toBe(r1.roundId);
    const res = await submitAiOrMe(p, week, '2026-11-14', { roundId: r1.roundId, answers: r1.cards.map((c) => c.answer) });
    expect(res.right).toBe(res.total);
    const fresh = (await getProfile(p.id))!;
    expect((await aiOrMeFor(fresh, week, '2026-11-14')).completed?.right).toBe(res.right);
    await expectHttp(submitAiOrMe(fresh, week, '2026-11-14', { roundId: r1.roundId, answers: [] }), 409, 'already_played');
  });

  it('work log: 3 a day, then 429; minutes are added to the latest proof of that task', async () => {
    const p = await nurse();
    const taskId = p.shares![0].taskId;
    await updateProfile(p.id, (x) => {
      x.proof.push({ id: 'pf', repId: 'r', type: 'slip', taskId, occupationCode: NURSE, score: 1, summaryKey: 'proof.slip', summaryParams: {}, at: '', public: false });
    });
    const now = at('2026-11-14T15:00:00Z');
    for (let i = 0; i < 3; i++) await logWork((await getProfile(p.id))!, 'America/Chicago', { taskId, minutes: 20 }, now);
    await expectHttp(logWork((await getProfile(p.id))!, 'America/Chicago', { taskId, minutes: 20 }, now), 429, 'work_log_limit');
    expect((await getProfile(p.id))!.proof[0].summaryParams.workMinutes).toBe(60);
    await expectHttp(logWork((await getProfile(p.id))!, null, { taskId: 'nope', minutes: 20 }, now), 400, 'invalid_input');
  });
});
