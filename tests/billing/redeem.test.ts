import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '@/domain/types';
import { PROMO_RE, redeem, setStripeForTests } from '@/server/billing';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../platform/helpers';
import { createStripeStub, type StripeStub } from './stripe-stub';

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

async function withPoints(balance: number, change: (p: Profile) => void = () => undefined): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  const { profile: p } = await updateProfile(profile.id, (x) => {
    x.points.balance = balance;
    change(x);
  });
  return p;
}

async function expectHttp(p: Promise<unknown>, status: number, code: string): Promise<HttpError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).status).toBe(status);
  expect((e as HttpError).code).toBe(code);
  return e as HttpError;
}

describe('redeem pro rewards', () => {
  it('250 points → a one-use IRR code for the 10% coupon, issued for the next checkout', async () => {
    const p = await withPoints(300);
    const res = await redeem(p, { rewardId: 'pro_10' });
    expect(res.created).toBe(true);
    expect(res.balance).toBe(50);
    expect(res.redemption).toMatchObject({ rewardId: 'pro_10', cost: 250, status: 'issued' });
    expect(res.redemption.code).toMatch(PROMO_RE);
    const promo = stub.promos.get(res.redemption.promotionCodeId!)!;
    expect(promo).toMatchObject({ code: res.redemption.code, max_redemptions: 1, coupon: 'irr_pro_10', metadata: { profileId: p.id, rewardId: 'pro_10', redemptionId: res.redemption.id } });
    expect(stub.coupons.get('irr_pro_10')).toMatchObject({ percent_off: 10, duration: 'once', metadata: { reward_id: 'pro_10' } });

    const saved = (await getProfile(p.id))!;
    expect(saved.points.balance).toBe(50);
    expect(saved.points.events.at(-1)).toMatchObject({ type: 'redeem', points: -250, ref: res.redemption.id });
    expect(saved.redemptions).toEqual([res.redemption]);
  });

  it('the coupon is created once and reused', async () => {
    const a = await withPoints(600);
    await redeem(a, { rewardId: 'pro_10' });
    const b = await withPoints(600);
    await redeem(b, { rewardId: 'pro_10' });
    expect(stub.callsOf('coupons.create')).toHaveLength(1);
    expect(stub.callsOf('promotionCodes.create')).toHaveLength(2);
  });

  it('a second Pro code while one is issued is 409 with the waiting code; nothing is spent', async () => {
    const p = await withPoints(5000);
    const first = await redeem(p, { rewardId: 'pro_10' });
    const e = await expectHttp(redeem((await getProfile(p.id))!, { rewardId: 'pro_25' }), 409, 'discount_pending');
    expect(e.extra).toMatchObject({ redemption: { id: first.redemption.id } });
    expect((await getProfile(p.id))!.points.balance).toBe(4750);
    expect(stub.callsOf('promotionCodes.create')).toHaveLength(1);
  });

  it('a Stripe error spends nothing and records nothing', async () => {
    const p = await withPoints(300);
    stub.failNext['promotionCodes.create'] = 'api_error';
    await expectHttp(redeem(p, { rewardId: 'pro_10' }), 502, 'payment_provider_error');
    const saved = (await getProfile(p.id))!;
    expect(saved.points.balance).toBe(300);
    expect(saved.redemptions).toEqual([]);
  });

  it('with a running subscription the months go onto it (applied), keeping its discounts', async () => {
    const end = Math.floor(Date.now() / 1000) + 5 * 86400;
    stub.subs.set('sub_live', {
      id: 'sub_live', status: 'trialing', customer: 'cus_1', trial_end: end, cancel_at: null, cancel_at_period_end: false, canceled_at: null, ended_at: null,
      discounts: ['di_old'], metadata: {}, items: { data: [{ current_period_end: end, price: { recurring: { interval: 'year' } } }] },
    });
    const p = await withPoints(9500, (x) => {
      x.plan = { status: 'trialing', source: 'stripe', periodEnd: new Date(end * 1000).toISOString(), stripeCustomerId: 'cus_1', subscriptionId: 'sub_live' };
    });
    const res = await redeem(p, { rewardId: 'pro_1m' });
    expect(res.redemption).toMatchObject({ status: 'applied', appliedTo: 'subscription' });
    expect(stub.coupons.get('irr_pro_1m')).toMatchObject({ percent_off: 100, duration: 'repeating', duration_in_months: 1 });
    const update = stub.callsOf('subscriptions.update')[0].args[1] as { discounts: object[] };
    expect(update.discounts).toEqual([{ discount: 'di_old' }, { promotion_code: res.redemption.promotionCodeId }]);
    expect(res.balance).toBe(500);
  });

  it('a lost race rolls the Stripe code back', async () => {
    const p = await withPoints(300);
    const [a, b] = await Promise.allSettled([redeem(p, { rewardId: 'pro_10' }), redeem(p, { rewardId: 'pro_10' })]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const failed = [a, b].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(['discount_pending', 'not_enough_points']).toContain((failed[0].reason as HttpError).code);
    const saved = (await getProfile(p.id))!;
    expect(saved.points.balance).toBe(50);
    const active = [...stub.promos.values()].filter((x) => x.active);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(saved.redemptions[0].promotionCodeId);
  });
});

describe('redeem other rewards and limits', () => {
  it('not enough points is 402 with how many are missing', async () => {
    const p = await withPoints(240);
    const e = await expectHttp(redeem(p, { rewardId: 'pro_10' }), 402, 'not_enough_points');
    expect(e.extra).toMatchObject({ need: 10, balance: 240 });
    await expectHttp(redeem(p, { rewardId: 'nope' }), 400, 'unknown_reward');
    await expectHttp(redeem(p, { rewardId: 'coming_soon_1' }), 400, 'not_available');
  });

  it('partner rewards need an email and become requested, with no Stripe call', async () => {
    const p = await withPoints(26_000);
    await expectHttp(redeem(p, { rewardId: 'claude_pro_1m' }), 400, 'email_required');
    const res = await redeem(p, { rewardId: 'claude_pro_1m', email: 'sam@example.com' });
    expect(res.redemption).toMatchObject({ status: 'requested', email: 'sam@example.com', cost: 25_000 });
    expect(res.redemption.code).toBeUndefined();
    expect(res.balance).toBe(1000);
    expect(stub.calls).toEqual([]);
  });

  it('streak freezes: +1 each, at most 2 held', async () => {
    const p = await withPoints(1000, (x) => {
      x.streak.freezes = 1;
    });
    const res = await redeem(p, { rewardId: 'streak_freeze' });
    expect(res.redemption.status).toBe('applied');
    const saved = (await getProfile(p.id))!;
    expect(saved.streak.freezes).toBe(2);
    await expectHttp(redeem(saved, { rewardId: 'streak_freeze' }), 409, 'freeze_limit');
    expect((await getProfile(p.id))!.points.balance).toBe(600);
  });

  it('a repeated requestId returns the first redemption without spending again', async () => {
    const p = await withPoints(1000);
    const a = await redeem(p, { rewardId: 'pro_10', requestId: 'click-12345678' });
    const b = await redeem((await getProfile(p.id))!, { rewardId: 'pro_10', requestId: 'click-12345678' });
    expect(b.created).toBe(false);
    expect(b.redemption).toEqual(a.redemption);
    expect((await getProfile(p.id))!.points.balance).toBe(750);
    expect(stub.callsOf('promotionCodes.create')).toHaveLength(1);
  });
});
