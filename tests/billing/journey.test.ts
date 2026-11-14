import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as pointsGET } from '@/app/api/points/route';
import { POST as cupPOST } from '@/app/api/billing/cup/route';
import { GET as todayGET } from '@/app/api/reps/today/route';
import { POST as redeemPOST } from '@/app/api/shop/redeem/route';
import type { RepView } from '@/domain/reps';
import { PROMO_RE, setStripeForTests } from '@/server/billing';
import { createProfile, getProfile } from '@/server/profile';
import { aiOrMeFor, answerRep, resetBankCache, startTrial, submitAiOrMe, weekOf } from '@/server/reps';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { useTempStore } from '../platform/helpers';
import { nurseEdge, nurseSlip, writeBank } from '../reps/fixtures';
import { createStripeStub } from './stripe-stub';

// Reps are always written live (round 3: the bank is never served); the writer is stubbed with the fixture slip.
vi.mock('@/server/reps/generate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/reps/generate')>();
  const { nurseSlip: slip } = await import('../reps/fixtures');
  return {
    ...real,
    generateSlip: vi.fn(async (input: { occupationCode: string; taskId: string }) => ({
      entry: { ...slip(input.taskId), occupationCode: input.occupationCode, taskId: input.taskId },
      attempts: 1,
      costUsd: 0,
      rejected: [],
    })),
  };
});

/**
 * Whole paths through the real routes and the reps engine (stubbed rep writer, no model, fs store, Stripe stub),
 * with DEV_FORCE_PRO switched off so Pro comes only from the plan.
 */

const NURSE = '29-1141.00';
const env = { ...process.env };
let bankDir: string;
let cleanup: () => void;

beforeAll(() => {
  bankDir = mkdtempSync(path.join(tmpdir(), 'irr-bank-'));
  Object.assign(process.env, { REP_BANK_DIR: bankDir, OPENROUTER_API_KEY: 'test-key', AI_BUDGET_USD: '0' });
  delete process.env.DEV_FORCE_PRO;
});
afterAll(() => {
  process.env = env;
  rmSync(bankDir, { recursive: true, force: true });
});
beforeEach(async () => {
  ({ cleanup } = useTempStore());
  setStripeForTests(createStripeStub().stripe);
  const week = typicalWeek((await loadBundle(NURSE))!).shares;
  writeBank(bankDir, [nurseSlip(week[0].taskId), nurseEdge(week[1].taskId)]);
  resetBankCache();
});
afterEach(() => {
  setStripeForTests(null);
  cleanup();
});

async function nurse() {
  const { profile, secret } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  const { awards } = await createXray({ profile, occupationCode: NURSE, shares: typicalWeek((await loadBundle(NURSE))!).shares, jobTitle: 'RN', inputSource: 'title' });
  const headers = { 'x-profile-id': profile.id, 'x-profile-secret': secret, 'x-tz': 'America/Chicago', 'content-type': 'application/json' };
  return { id: profile.id, headers, awards };
}

const req = (url: string, headers: Record<string, string>, init: RequestInit = {}) => new Request(`http://localhost${url}`, { ...init, headers });

describe('Business Cup offer through the API', () => {
  it('a fresh profile is Free on Today, then one POST /api/billing/cup makes Today answer 200 as Pro', async () => {
    expect(process.env.DEV_FORCE_PRO).toBeUndefined();
    const n = await nurse();
    const free = await todayGET(req('/api/reps/today', n.headers));
    expect(free.status).toBe(402);

    const unlocked = await cupPOST(req('/api/billing/cup', n.headers, { method: 'POST' }));
    expect(unlocked.status).toBe(201);
    expect(await unlocked.json()).toMatchObject({ isPro: true, plan: { status: 'pro', source: 'cup', tier: 'coach' }, offer: { until: '2026-11-30', tier: 'coach', tierName: 'Max' } });

    const today = await todayGET(req('/api/reps/today', n.headers));
    expect(today.status).toBe(200);
    const body = await today.json();
    expect(body).toHaveProperty('choiceTasks');
    expect(body.nextKind).toBe('daily');

    const repeat = await cupPOST(req('/api/billing/cup', n.headers, { method: 'POST' }));
    expect(repeat.status).toBe(200);
  });
});

describe('first session → first reward', () => {
  it('map, trial rep and AI or me earn at least 250, and 250 buy the 10% code', async () => {
    const n = await nurse();
    expect(n.awards.map((a) => [a.type, a.points])).toEqual([
      ['xray_completed', 100],
      ['week_confirmed', 20],
    ]);

    const ctx = async (now: string) => ({ profile: (await getProfile(n.id))!, headerTz: 'America/Chicago', now: new Date(now) });
    const trial = (await startTrial(await ctx('2026-11-14T15:00:00Z'))) as { rep: RepView };
    const errors = nurseSlip('x').slip.errors;
    // the person finds two of the three mistakes
    const done = await answerRep(await ctx('2026-11-14T15:10:00Z'), trial.rep.id, { ranges: errors.slice(0, 2).map((e) => [e.start, e.end]) });
    expect(done.pointsAwarded.map((a) => a.type)).toEqual(['rep_completed', 'first_rep']);
    expect(done.rep.result!.points).toBe(done.pointsAwarded.reduce((s, a) => s + a.points, 0));

    const p = (await getProfile(n.id))!;
    const week = (await weekOf(p))!;
    const round = await aiOrMeFor(p, week, '2026-11-14');
    const ai = await submitAiOrMe(p, week, '2026-11-14', { roundId: round.roundId, answers: round.cards.map((c) => c.answer) });
    expect(ai.pointsAwarded[0]).toMatchObject({ type: 'ai_or_me', points: 10 + 5 * ai.right });

    const points = await (await pointsGET(req('/api/points', n.headers))).json();
    expect(points.balance).toBeGreaterThanOrEqual(250);
    expect(points.available).toContain('pro_10');
    expect(points.rules.length).toBeGreaterThan(10);

    const res = await redeemPOST(req('/api/shop/redeem', n.headers, { method: 'POST', body: JSON.stringify({ rewardId: 'pro_10', requestId: 'first-reward-1' }) }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.redemption.code).toMatch(PROMO_RE);
    expect(body.balance).toBe(points.balance - 250);
  });
});
