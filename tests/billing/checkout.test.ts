import Stripe from 'stripe';
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '@/domain/types';
import { confirmCheckout, createCheckout, createPortal, ensureFreshPlan, handleWebhook, isCoach, redeem, setStripeForTests } from '@/server/billing';
import { createProfile, getProfile, isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../platform/helpers';
import { createStripeStub, type StripeStub } from './stripe-stub';

const ORIGIN = 'http://localhost:3000';
const noForce = { DEV_FORCE_PRO: undefined } as unknown as NodeJS.ProcessEnv;

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

async function fresh(change: (p: Profile) => void = () => undefined): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en' });
  return (await updateProfile(profile.id, change)).profile;
}

async function expectHttp(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect((e as HttpError).status).toBe(status);
  expect((e as HttpError).code).toBe(code);
}

const sessionParams = () => stub.callsOf('checkout.sessions.create').at(-1)!.args[0] as Record<string, unknown>;

describe('checkout', () => {
  it('yearly by default: 7-day trial, card asked for, promotion codes allowed, return URLs, one customer per profile', async () => {
    const p = await fresh();
    const { url } = await createCheckout(p, { tier: 'pro', interval: 'year' }, ORIGIN);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(sessionParams()).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_pro_yearly', quantity: 1 }],
      client_reference_id: p.id,
      metadata: { profileId: p.id, tier: 'pro', interval: 'year' },
      subscription_data: { trial_period_days: 7, metadata: { profileId: p.id, tier: 'pro' } },
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      success_url: `${ORIGIN}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${ORIGIN}/pricing?canceled=1`,
    });
    expect(sessionParams()).not.toHaveProperty('discounts');
    const saved = (await getProfile(p.id))!;
    expect(saved.plan.stripeCustomerId).toMatch(/^cus_/);
    await createCheckout(saved, { tier: 'pro', interval: 'month' }, ORIGIN);
    expect(stub.callsOf('customers.create')).toHaveLength(1);
    expect(sessionParams()).toMatchObject({ line_items: [{ price: 'price_pro_monthly' }], customer: saved.plan.stripeCustomerId });
  });

  it('an issued shop code goes into discounts; free months need no card', async () => {
    const p = await fresh((x) => {
      x.points.balance = 10_000;
    });
    await redeem(p, { rewardId: 'pro_10' });
    const withTen = (await getProfile(p.id))!;
    await createCheckout(withTen, { tier: 'pro', interval: 'year' }, ORIGIN);
    expect(sessionParams()).toMatchObject({ discounts: [{ promotion_code: withTen.redemptions[0].promotionCodeId }], payment_method_collection: 'always' });
    expect(sessionParams()).not.toHaveProperty('allow_promotion_codes');

    const q = await fresh((x) => {
      x.points.balance = 10_000;
    });
    await redeem(q, { rewardId: 'pro_1m' });
    await createCheckout((await getProfile(q.id))!, { tier: 'pro', interval: 'month' }, ORIGIN);
    expect(sessionParams()).toMatchObject({ payment_method_collection: 'if_required' });
  });

  it('a running Stripe subscription cannot check out again', async () => {
    const p = await fresh((x) => {
      x.plan = { status: 'pro', source: 'stripe', subscriptionId: 'sub_1', stripeCustomerId: 'cus_1', periodEnd: new Date(Date.now() + 86400_000).toISOString() };
    });
    await expectHttp(createCheckout(p, { tier: 'pro', interval: 'year' }, ORIGIN), 409, 'already_subscribed');
  });
});

describe('confirm', () => {
  it('a finished checkout gives a trial with its end date and applies the shop code; repeatable', async () => {
    const p = await fresh((x) => {
      x.points.balance = 300;
    });
    await redeem(p, { rewardId: 'pro_10' });
    const before = (await getProfile(p.id))!;
    await createCheckout(before, { tier: 'pro', interval: 'year' }, ORIGIN);
    const sid = [...stub.sessions.keys()].at(-1)!;
    await expectHttp(confirmCheckout(before, sid), 409, 'checkout_open');
    const sub = stub.completeSession(sid);

    const { plan } = await confirmCheckout((await getProfile(p.id))!, sid);
    expect(plan).toMatchObject({ status: 'trialing', source: 'stripe', tier: 'pro', subscriptionId: sub.id, interval: 'year', periodEnd: new Date(sub.trial_end! * 1000).toISOString() });
    const after = (await getProfile(p.id))!;
    expect(isPro(after, new Date(), noForce)).toBe(true);
    expect(after.redemptions[0]).toMatchObject({ status: 'applied', appliedTo: 'checkout' });
    expect((await confirmCheckout(after, sid)).plan.status).toBe('trialing');

    const other = await fresh();
    await expectHttp(confirmCheckout(other, sid), 404, 'not_found');
    await expectHttp(confirmCheckout(other, 'not-a-session'), 400, 'invalid_input');
  });
});

describe('Coach tier', () => {
  it('a Coach checkout uses the coach price with the same trial; confirm gives a Coach plan', async () => {
    const p = await fresh();
    await createCheckout(p, { tier: 'coach', interval: 'month' }, ORIGIN);
    expect(sessionParams()).toMatchObject({
      line_items: [{ price: 'price_max_monthly', quantity: 1 }],
      metadata: { tier: 'coach', interval: 'month' },
      subscription_data: { trial_period_days: 7, metadata: { tier: 'coach' } },
      payment_method_collection: 'always',
    });
    const sid = [...stub.sessions.keys()].at(-1)!;
    stub.completeSession(sid);
    const { plan } = await confirmCheckout((await getProfile(p.id))!, sid);
    expect(plan).toMatchObject({ status: 'trialing', tier: 'coach', interval: 'month' });
    const saved = (await getProfile(p.id))!;
    expect(isCoach(saved, new Date(), noForce)).toBe(true);
    expect(isPro(saved, new Date(), noForce)).toBe(true);
  });

  it("POST /api/billing/checkout takes tier 'max' (the display name) as the top tier", async () => {
    const { profile, secret } = await createProfile({ locale: 'en' });
    const res = await checkoutPOST(
      new Request('http://localhost/api/billing/checkout', {
        method: 'POST',
        headers: { 'x-profile-id': profile.id, 'x-profile-secret': secret, 'content-type': 'application/json' },
        body: JSON.stringify({ tier: 'max', interval: 'year' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(sessionParams()).toMatchObject({ line_items: [{ price: 'price_max_yearly' }], metadata: { tier: 'coach', interval: 'year' } });
  });

  it('free Pro months stay Pro: not attached to a Coach checkout, not redeemable on a Coach subscription', async () => {
    const p = await fresh((x) => {
      x.points.balance = 20_000;
    });
    await redeem(p, { rewardId: 'pro_1m' });
    expect(stub.coupons.get('irr_pro_1m_v2')).toMatchObject({ percent_off: 100, applies_to: { products: ['irr_pro'] } });
    await createCheckout((await getProfile(p.id))!, { tier: 'coach', interval: 'year' }, ORIGIN);
    expect(sessionParams()).toMatchObject({ allow_promotion_codes: true, payment_method_collection: 'always' });
    expect(sessionParams()).not.toHaveProperty('discounts');

    const c = await fresh((x) => {
      x.points.balance = 20_000;
      x.plan = { status: 'pro', source: 'stripe', tier: 'coach', subscriptionId: 'sub_c', stripeCustomerId: 'cus_c', periodEnd: new Date(Date.now() + 86400_000).toISOString() };
    });
    await expectHttp(redeem(c, { rewardId: 'pro_1m' }), 409, 'pro_only');
  });

  it('a tier change in the portal is picked up by the next sync', async () => {
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    stub.subs.set('sub_t', {
      id: 'sub_t', status: 'active', customer: 'cus_t', trial_end: null, cancel_at: null, cancel_at_period_end: false, canceled_at: null, ended_at: null,
      discounts: [], metadata: {}, items: { data: [{ current_period_end: end, price: { lookup_key: 'coach_monthly', recurring: { interval: 'month' } } }] },
    });
    const p = await fresh((x) => {
      x.plan = { status: 'pro', source: 'stripe', tier: 'pro', subscriptionId: 'sub_t', stripeCustomerId: 'cus_t', periodEnd: new Date(end * 1000).toISOString() };
    });
    const synced = await ensureFreshPlan(p, { force: true });
    expect(synced.plan).toMatchObject({ tier: 'coach', status: 'pro' });
  });
});

describe('plan sync, portal and webhook', () => {
  const past = () => new Date(Date.now() - 60_000).toISOString();

  it('an expired trial is read again: paid → pro with the new period; canceled → free and no Pro', async () => {
    const yearOn = Math.floor(Date.now() / 1000) + 365 * 86400;
    stub.subs.set('sub_a', {
      id: 'sub_a', status: 'active', customer: 'cus_a', trial_end: null, cancel_at: null, cancel_at_period_end: false, canceled_at: null, ended_at: null,
      discounts: [], metadata: {}, items: { data: [{ current_period_end: yearOn, price: { recurring: { interval: 'year' } } }] },
    });
    const a = await fresh((x) => {
      x.plan = { status: 'trialing', source: 'stripe', subscriptionId: 'sub_a', stripeCustomerId: 'cus_a', periodEnd: past() };
    });
    expect(isPro(a, new Date(), noForce)).toBe(false);
    const synced = await ensureFreshPlan(a);
    expect(synced.plan).toMatchObject({ status: 'pro', periodEnd: new Date(yearOn * 1000).toISOString() });
    expect(isPro(synced, new Date(), noForce)).toBe(true);

    stub.subs.set('sub_b', {
      id: 'sub_b', status: 'canceled', customer: 'cus_b', trial_end: null, cancel_at: null, cancel_at_period_end: true, canceled_at: 1, ended_at: Math.floor(Date.now() / 1000) - 60,
      discounts: [], metadata: {}, items: { data: [{ current_period_end: 1, price: { recurring: { interval: 'month' } } }] },
    });
    const b = await fresh((x) => {
      x.plan = { status: 'trialing', source: 'stripe', subscriptionId: 'sub_b', stripeCustomerId: 'cus_b', periodEnd: past(), cancelAtPeriodEnd: true };
    });
    const ended = await ensureFreshPlan(b);
    expect(ended.plan.status).toBe('free');
    expect(isPro(ended, new Date(), noForce)).toBe(false);
    // ended and confirmed: no more Stripe calls for it
    const n = stub.callsOf('subscriptions.retrieve').length;
    await ensureFreshPlan(ended);
    expect(stub.callsOf('subscriptions.retrieve')).toHaveLength(n);
  });

  it('a Stripe outage keeps the stored plan', async () => {
    const p = await fresh((x) => {
      x.plan = { status: 'trialing', source: 'stripe', subscriptionId: 'sub_x', periodEnd: past() };
    });
    stub.failNext['subscriptions.retrieve'] = 'api_error';
    expect((await ensureFreshPlan(p)).plan).toEqual(p.plan);
  });

  it('portal: 404 without Stripe billing, else a portal URL with our configuration', async () => {
    await expectHttp(createPortal(await fresh(), ORIGIN, '/pricing'), 404, 'no_subscription');
    const p = await fresh((x) => {
      x.plan = { ...x.plan, stripeCustomerId: 'cus_9' };
    });
    const { url } = await createPortal(p, ORIGIN, '/pricing?portal=1');
    expect(url).toContain('cus_9');
    expect(stub.callsOf('billingPortal.sessions.create')[0].args[0]).toEqual({ customer: 'cus_9', return_url: `${ORIGIN}/pricing?portal=1`, configuration: 'bpc_1' });
  });

  it('webhook: a signed subscription event updates the plan; a bad signature is 400', async () => {
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const p = await fresh((x) => {
      x.plan = { status: 'trialing', source: 'stripe', subscriptionId: 'sub_w', stripeCustomerId: 'cus_w', periodEnd: new Date(Date.now() + 86400_000).toISOString() };
    });
    stub.subs.set('sub_w', {
      id: 'sub_w', status: 'active', customer: 'cus_w', trial_end: null, cancel_at: end, cancel_at_period_end: true, canceled_at: null, ended_at: null,
      discounts: [], metadata: { profileId: p.id }, items: { data: [{ current_period_end: end, price: { recurring: { interval: 'month' } } }] },
    });
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: { id: 'sub_w', object: 'subscription', metadata: { profileId: p.id } } } });
    const secret = 'whsec_test_secret';
    const header = new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload, secret });
    const res = await handleWebhook(payload, header, secret);
    expect(res).toMatchObject({ received: true, updated: true });
    expect((await getProfile(p.id))!.plan).toMatchObject({ status: 'pro', cancelAtPeriodEnd: true, interval: 'month' });
    await expectHttp(handleWebhook(payload, 't=1,v1=bad', secret), 400, 'invalid_signature');
  });
});
