import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as reviewKitPOST } from '@/app/api/review-kit/route';
import { PLANS } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { freeLeft, runSecondLook, secondLookState } from '@/server/playbook';
import { createProfile, isCoach, isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../platform/helpers';

/**
 * Playbook, Second look and the Review kit come with Max (round 3 rebalance): Pro keeps the free tastes
 * (the first Playbook card, one Second look, the Review kit preview) and gets «Comes with Max».
 */

let cleanup: () => void;
const saved = { pro: process.env.DEV_FORCE_PRO, coach: process.env.DEV_FORCE_COACH };
beforeEach(() => {
  ({ cleanup } = useTempStore());
  delete process.env.DEV_FORCE_PRO;
  delete process.env.DEV_FORCE_COACH;
});
afterEach(() => {
  cleanup();
  if (saved.pro === undefined) delete process.env.DEV_FORCE_PRO;
  else process.env.DEV_FORCE_PRO = saved.pro;
  if (saved.coach === undefined) delete process.env.DEV_FORCE_COACH;
  else process.env.DEV_FORCE_COACH = saved.coach;
});

const inMonth = () => new Date(Date.now() + 30 * 86400_000).toISOString();

async function withPlan(plan: Profile['plan'] | null, extra: (p: Profile) => void = () => undefined) {
  const { profile, secret } = await createProfile({ locale: 'en' });
  const { profile: next } = await updateProfile(profile.id, (p) => {
    if (plan) p.plan = plan;
    extra(p);
  });
  return { profile: next, secret };
}

const PRO: Profile['plan'] = { status: 'pro', source: 'stripe', tier: 'pro', subscriptionId: 'sub_p', stripeCustomerId: 'cus_p', periodEnd: inMonth() };
const MAX: Profile['plan'] = { status: 'pro', source: 'stripe', tier: 'coach', subscriptionId: 'sub_m', stripeCustomerId: 'cus_m', periodEnd: inMonth() };
const CUP: Profile['plan'] = { status: 'pro', source: 'cup', tier: 'coach', periodEnd: inMonth() };

const TEXT = 'Dear team, the new schedule starts on Monday. Every nurse covers two extra shifts this month, and overtime is paid at the normal rate.';

describe('Max features', () => {
  it('PLANS: Playbook, Second look and the Review kit are listed under Max, not Pro; the PDF report is Free', () => {
    const ids = (i: number) => PLANS[i].features.map((f) => f.id);
    expect(ids(2)).toEqual(expect.arrayContaining(['coach_chat', 'playbook', 'second_look', 'review_kit']));
    expect(ids(1)).not.toEqual(expect.arrayContaining(['playbook']));
    expect(ids(1).some((id) => ['playbook', 'second_look', 'review_kit', 'pdf_report'].includes(id))).toBe(false);
    expect(ids(0)).toContain('pdf_report');
  });

  it('Second look: Free and Pro get one free run, Max (paid or Business Cup) has no limit', async () => {
    const free = await withPlan(null);
    const pro = await withPlan(PRO);
    const max = await withPlan(MAX);
    const cup = await withPlan(CUP);
    expect(isPro(pro.profile) && !isCoach(pro.profile)).toBe(true);
    expect(freeLeft(free.profile)).toBe(1);
    expect(freeLeft(pro.profile)).toBe(1);
    expect(freeLeft(max.profile)).toBeNull();
    expect(freeLeft(cup.profile)).toBeNull();
    expect((await secondLookState(pro.profile, 'en')).pro).toBe(false);
    expect((await secondLookState(max.profile, 'en')).pro).toBe(true);
  });

  it('Second look: a Pro profile that used its free run gets 402 max_required before any model call', async () => {
    const pro = await withPlan(PRO, (p) => {
      (p as Profile & { playbook?: { secondLook?: { used: number; lastAt: string } } }).playbook = { secondLook: { used: 1, lastAt: new Date().toISOString() } };
    });
    const err = await runSecondLook({ profile: pro.profile, headerTz: null, ip: null }, { text: TEXT, taskId: null, locale: 'en' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 402, code: 'max_required' });
  });

  it('Review kit: Pro gets 402 max_required', async () => {
    const pro = await withPlan(PRO);
    const res = await reviewKitPOST(
      new Request('http://localhost/api/review-kit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-profile-id': pro.profile.id, 'x-profile-secret': pro.secret },
        body: JSON.stringify({ locale: 'en' }),
      }),
    );
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe('max_required');
  });
});
