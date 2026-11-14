import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Range, RepView } from '@/domain/reps';
import type { Profile } from '@/domain/types';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { aiOrMeFor, answerRep, createRep, getToday, logWork, resetBankCache, startTrial, submitAiOrMe, weekOf, type RepCtx } from '@/server/reps';
import { MAX_EXTRAS_PER_DAY } from '@/server/reps/service';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { POINT_RULES, REP_POINTS, repPoints } from '@/domain/points';
import { readBank, findBankSlip } from '@/server/reps';
import { writeFileSync } from 'node:fs';
import { useTempStore } from '../platform/helpers';
import { nurseEdge, nurseSlip, writeBank } from './fixtures';

/**
 * The engine without the model: AI_BUDGET_USD=0 makes every model call fail with budget_exceeded
 * before any network request, so reps come from a temporary bank.
 */

const NURSE = '29-1141.00';
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
  rmSync(bankDir, { recursive: true, force: true });
  const bundle = (await loadBundle(NURSE))!;
  const week = typicalWeek(bundle).shares;
  writeBank(bankDir, [nurseSlip(week[0].taskId), nurseEdge(week[1].taskId)]);
  resetBankCache();
});
afterEach(() => cleanup());

async function nurse(): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  const bundle = (await loadBundle(NURSE))!;
  await createXray({ profile, occupationCode: NURSE, shares: typicalWeek(bundle).shares, jobTitle: 'RN', inputSource: 'title' });
  return (await getProfile(profile.id))!;
}

const at = (iso: string) => new Date(iso);
async function ctx(id: string, now: string, extra: Partial<RepCtx> = {}): Promise<RepCtx> {
  return { profile: (await getProfile(id))!, headerTz: 'America/Chicago', now: at(now), ...extra };
}
const exactRanges = (rep: RepView, all = true): Range[] => {
  // the client never sees the errors; tests read them from the bank fixture
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

describe('reps without budget (bank fallback)', () => {
  it('a daily slip comes from the bank, is graded exactly and recorded once', async () => {
    const p = await nurse();
    const made = await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' });
    expect('rep' in made).toBe(true);
    const rep = (made as { rep: RepView }).rep;
    expect(rep).toMatchObject({ source: 'bank', status: 'open', notes: ['prepared_maintenance'], slip: { errorCount: 3 } });
    expect(rep).not.toHaveProperty('reveal');

    await expectHttp(createRep(await ctx(p.id, '2026-11-14T16:00:00Z'), { type: 'slip', kind: 'daily' }), 409, 'daily_exists');

    const done = await answerRep(await ctx(p.id, '2026-11-14T16:00:00Z'), rep.id, { ranges: exactRanges(rep) });
    // points (stage 04) come from the rule table: daily rep at score 1, perfect, first rep
    const award = (type: string, ruleId: string, points: number) => ({ type, points, labelKey: POINT_RULES.find((r) => r.id === ruleId)!.labelKey });
    const expected = [award('rep_completed', 'rep_daily', repPoints('daily', 1)), award('rep_perfect', 'rep_perfect', REP_POINTS.perfect), award('first_rep', 'first_rep', REP_POINTS.first)];
    const total = expected.reduce((n, a) => n + a.points, 0);
    expect(done.rep.result).toMatchObject({ score: 1, found: 3, total: 3, falseFlags: 0, points: total });
    expect(done.rep.result!.scoreChange).toMatchObject({ from: expect.any(Number), to: expect.any(Number), fromExact: expect.any(Number), toExact: expect.any(Number) });
    expect(done.rep.result!.scoreChange.toExact).toBeGreaterThan(done.rep.result!.scoreChange.fromExact);
    expect(done.rep.reveal?.errors).toHaveLength(3);
    expect(done.rep.result!.scoreChange.after).toBeGreaterThanOrEqual(done.rep.result!.scoreChange.before);
    expect(done.pointsAwarded).toEqual(expected);
    expect(done.streak.current).toBe(1);
    const after = (await getProfile(p.id))!;
    expect(after.repLog.find((r) => r.id === rep.id)?.score).toBe(1);
    expect(after.proof).toHaveLength(1);
    expect(after.proof[0]).toMatchObject({ summaryKey: 'proof.slip', summaryParams: { found: 3, total: 3, doc: 'discharge instructions' } });

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

  it('delegate without a bank delegate becomes a slip with a caption; edge comes from the bank', async () => {
    const p = await nurse();
    const d = (await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'delegate', kind: 'daily' })) as { rep: RepView };
    expect(d.rep).toMatchObject({ type: 'slip', source: 'bank', notes: ['prepared_maintenance', 'type_swapped'] });
    const e = (await createRep(await ctx(p.id, '2026-11-14T15:10:00Z'), { type: 'edge', kind: 'extra' })) as { rep: RepView };
    expect(e.rep.type).toBe('edge');
    expect(e.rep.edge).toMatchObject({ repliesLeft: 6, turns: [{ role: 'persona' }] });
    expect(JSON.stringify(e.rep)).not.toContain('unpaid leave'); // hidden reason stays hidden

    // the model is out mid-conversation: graded on what was said, ended_early, keywords decide
    const r = await answerRep(await ctx(p.id, '2026-11-14T15:12:00Z'), e.rep.id, {
      message: "I understand, waiting all day is frustrating. The pharmacy is doing a final medication check. I can't promise a time, but I will check with them and come back by 5.",
    });
    expect(r.rep.status).toBe('done');
    expect(r.rep.result?.flags).toEqual(['ended_early', 'keyword_grade']);
    expect(r.rep.result?.criteria?.map((c) => c.status)).toEqual(['met', 'met', 'met', 'met']);
    expect(r.rep.reveal?.personaHidden).toContain('unpaid leave');
    expect(r.streak.current).toBe(0); // an extra does not start the streak
  });

  it('extras stop at 3 a day; Free users get 402 with trial, AI or me and tomorrow', async () => {
    const p = await nurse();
    for (let i = 0; i < MAX_EXTRAS_PER_DAY; i++) await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'extra' });
    await expectHttp(createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'extra' }), 429, 'extra_limit');

    process.env.DEV_FORCE_PRO = '0';
    try {
      const err = await expectHttp(getToday(await ctx(p.id, '2026-11-14T15:00:00Z')), 402, 'pro_required');
      expect(err.extra).toMatchObject({ trial: { status: 'available' }, hasXray: true });
      expect((err.extra!.aiOrMe as { cards: unknown[] }).cards).toHaveLength(5);
      expect(err.extra!.tomorrow).toMatchObject({ taskId: expect.any(String), taskShort: expect.any(String) });
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });

  it('today shows choices with tasks of the week and the daily once made', async () => {
    const p = await nurse();
    const t1 = await getToday(await ctx(p.id, '2026-11-14T15:00:00Z'));
    expect(t1).toMatchObject({ daily: null, nextKind: 'daily', choices: ['slip', 'delegate', 'edge'] });
    const week = new Set(p.shares!.map((s) => s.taskId));
    for (const c of Object.values(t1.choiceTasks)) expect(week.has(c.taskId)).toBe(true);
    await createRep(await ctx(p.id, '2026-11-14T15:00:00Z'), { type: 'slip', kind: 'daily' });
    const t2 = await getToday(await ctx(p.id, '2026-11-14T15:30:00Z'));
    expect(t2.daily?.type).toBe('slip');
    expect(t2.nextKind).toBe('extra');
  });
});

describe('showcase', () => {
  it('an entry published on the landing (showcase.json) is never served, also not as a trial or fallback', async () => {
    const bundle = (await loadBundle(NURSE))!;
    const week = typicalWeek(bundle).shares;
    writeBank(bankDir, [nurseSlip(week[0].taskId), nurseSlip(week[1].taskId)]); // slip-1 and slip-2
    writeFileSync(path.join(bankDir, 'showcase.json'), JSON.stringify([`${NURSE}/slip-1.json`, `${NURSE}/edge-1.json`]));
    resetBankCache();
    expect((await readBank(NURSE, 'slip', 'en')).map((i) => i.file)).toEqual([`${NURSE}/slip-2.json`]);
    expect(await readBank(NURSE, 'edge', 'en')).toEqual([]);
    for (let i = 0; i < 10; i++) {
      const pick = await findBankSlip({ code: NURSE, locale: 'en', seed: `s${i}`, weekTaskIds: [week[0].taskId] });
      expect(pick?.item.file).toBe(`${NURSE}/slip-2.json`);
    }
    process.env.DEV_FORCE_PRO = '0';
    try {
      const p = await nurse();
      const t = (await startTrial(await ctx(p.id, '2026-11-14T15:00:00Z'))) as { rep: RepView };
      expect(t.rep.taskId).toBe(week[1].taskId); // the showcased slip-1 (task week[0]) is skipped
    } finally {
      process.env.DEV_FORCE_PRO = '1';
    }
  });
});

describe('trial', () => {
  it('is idempotent until completed, survives a reload, then 409 trial_used', async () => {
    process.env.DEV_FORCE_PRO = '0';
    try {
      const p = await nurse();
      const a = (await startTrial(await ctx(p.id, '2026-11-14T15:00:00Z'))) as { rep: RepView };
      const b = (await startTrial(await ctx(p.id, '2026-11-14T15:05:00Z'))) as { rep: RepView };
      expect(b.rep.id).toBe(a.rep.id);
      expect(a.rep).toMatchObject({ kind: 'trial', source: 'bank', type: 'slip', notes: ['prepared_maintenance'] });
      expect((await getProfile(p.id))!.trial).toEqual({ status: 'in_progress', repId: a.rep.id });
      const done = await answerRep(await ctx(p.id, '2026-11-14T15:10:00Z'), a.rep.id, { ranges: exactRanges(a.rep) });
      expect(done.streak.current).toBe(1);
      expect((await getProfile(p.id))!.trial).toEqual({ status: 'used', repId: a.rep.id });
      await expectHttp(startTrial(await ctx(p.id, '2026-11-15T15:00:00Z')), 409, 'trial_used');
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
