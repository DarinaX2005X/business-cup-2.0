import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CUP_OFFER_ENDS_AT, CUP_PRO_DAYS } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { setStripeForTests, unlockCup } from '@/server/billing';
import { createProfile, getProfile, isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../platform/helpers';
import { createStripeStub, type StripeStub } from './stripe-stub';

/** isPro without the local DEV_FORCE_PRO switch. */
const pro = (p: Pick<Profile, 'plan'>, now: Date) => isPro(p, now, { NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const NOW = new Date('2026-11-14T18:00:00Z');

let cleanup: () => void;
let stub: StripeStub;
beforeEach(() => {
  ({ cleanup } = useTempStore());
  stub = createStripeStub();
  setStripeForTests(stub.stripe);
});
afterEach(() => {
  setStripeForTests(null);
  cleanup();
});

async function expectHttp(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).status).toBe(status);
  expect((e as HttpError).code).toBe(code);
}

describe('Business Cup 2.0 offer', () => {
  it('one request gives a fresh profile Pro for 30 days with no Stripe call; a repeat returns the same plan', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    expect(pro(profile, NOW)).toBe(false);
    const first = await unlockCup(profile, NOW);
    expect(first.created).toBe(true);
    expect(first.plan).toEqual({ status: 'pro', source: 'cup', periodEnd: new Date(NOW.getTime() + CUP_PRO_DAYS * 86_400_000).toISOString() });
    const saved = (await getProfile(profile.id))!;
    expect(pro(saved, NOW)).toBe(true);
    const again = await unlockCup(saved, new Date('2026-11-20T00:00:00Z'));
    expect(again).toEqual({ plan: first.plan, created: false });
    expect(stub.calls).toEqual([]);
  });

  it('Pro holds until periodEnd and ends after it', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const { plan } = await unlockCup(profile, NOW);
    const end = Date.parse(plan.periodEnd!);
    expect(pro({ plan }, new Date(end - 1000))).toBe(true);
    expect(pro({ plan }, new Date(end + 1000))).toBe(false);
  });

  it('after November 30 (anywhere on Earth) the offer is 410 offer_ended', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    await unlockCup(profile, new Date('2026-11-30T23:00:00-11:00')); // still Nov 30 locally in UTC−11
    const { profile: late } = await createProfile({ locale: 'en' });
    await expectHttp(unlockCup(late, new Date(Date.parse(CUP_OFFER_ENDS_AT) + 1)), 410, 'offer_ended');
    expect((await getProfile(late.id))!.plan.status).toBe('free');
  });

  it('a running Stripe subscription or trial is 409 already_pro; an ended one can take the offer', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const { profile: trialing } = await updateProfile(profile.id, (p) => {
      p.plan = { status: 'trialing', source: 'stripe', subscriptionId: 'sub_1', stripeCustomerId: 'cus_1', periodEnd: '2026-11-20T00:00:00.000Z' };
    });
    await expectHttp(unlockCup(trialing, NOW), 409, 'already_pro');
    const ended = await unlockCup(trialing, new Date('2026-11-21T00:00:00Z'));
    expect(ended.plan).toMatchObject({ status: 'pro', source: 'cup', subscriptionId: 'sub_1', stripeCustomerId: 'cus_1' });
  });
});
