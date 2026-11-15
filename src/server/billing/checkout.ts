import type Stripe from 'stripe';
import { pendingProCode, rewardById, TIER_PRICES, tierOf, TRIAL_DAYS, type BillingInterval, type Tier } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { planFromSubscription, stripeActive } from './plan';
import { getStripe, stripeCall, stripeCode, type BillingStripe } from './stripe';

/**
 * Checkout, confirmation and the Billing Portal (04.1.3). The Stripe Checkout page itself takes the
 * card; a declined card keeps the person on Stripe's page with Stripe's message, and Cancel returns
 * to /pricing?canceled=1.
 */

/** Public origin for return URLs: NEXT_PUBLIC_SITE_URL, else the request's own origin. */
export function siteOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) {
    try {
      const u = new URL(env);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(req.url).origin;
}

const priceCache = new Map<string, { id: string; at: number }>();
const PRICE_TTL_MS = 10 * 60_000;

/** The active price for `pro_monthly` / `pro_yearly` / `max_monthly` / `max_yearly` (created by `npm run stripe:setup`). */
export async function priceFor(interval: BillingInterval, tier: Tier = 'pro'): Promise<string> {
  const lookupKey = TIER_PRICES[tier][interval].lookupKey;
  const hit = priceCache.get(lookupKey);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.id;
  const list = await stripeCall('price lookup', (s) => s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 }));
  const price = list.data[0];
  if (!price) {
    console.error(`[billing] no active Stripe price with lookup_key ${lookupKey}; run npm run stripe:setup`);
    throw new HttpError(503, 'billing_unavailable', 'Plan prices are not set up in Stripe yet.');
  }
  priceCache.set(lookupKey, { id: price.id, at: Date.now() });
  return price.id;
}

/** The profile's Stripe customer, created once (the idempotency key makes parallel calls return one customer). */
export async function ensureCustomer(profile: Profile): Promise<{ customerId: string; profile: Profile }> {
  if (profile.plan.stripeCustomerId) return { customerId: profile.plan.stripeCustomerId, profile };
  const customer = await stripeCall('customer', (s) =>
    s.customers.create({ metadata: { profileId: profile.id }, description: 'Irreplaceable profile' }, { idempotencyKey: `irr-customer-${profile.id}` }),
  );
  const { profile: saved } = await updateProfile(
    profile.id,
    (p) => {
      if (!p.plan.stripeCustomerId) p.plan = { ...p.plan, stripeCustomerId: customer.id };
    },
    { current: profile },
  );
  return { customerId: saved.plan.stripeCustomerId!, profile: saved };
}

/**
 * A Checkout Session for Pro or Max (tier id 'coach'). Both tiers get the 7-day trial on a first
 * subscription. A shop code waiting for checkout goes in, except free Pro months on a Max checkout (Pro only).
 * Switching tiers on a running subscription happens in the Billing Portal.
 */
export async function createCheckout(
  profile: Profile,
  choice: { tier: Tier; interval: BillingInterval },
  origin: string,
  now: Date = new Date(),
): Promise<{ url: string; id: string }> {
  const { tier, interval } = choice;
  if (stripeActive(profile.plan, now)) {
    throw new HttpError(409, 'already_subscribed', 'You already have a paid plan through Stripe. Change or manage it in the billing portal.', {
      tier: tierOf(profile.plan),
    });
  }
  const price = await priceFor(interval, tier);
  const { customerId, profile: current } = await ensureCustomer(profile);
  const waiting = pendingProCode(current);
  const waitingReward = waiting ? rewardById(waiting.rewardId) : undefined;
  const pending = waiting && !(tier === 'coach' && waitingReward?.kind === 'pro_months') ? waiting : undefined;
  const pendingReward = pending ? waitingReward : undefined;
  // A trial is for the first subscription only.
  const trial = !current.plan.subscriptionId;

  const base: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    // show the US price as is ($19 / $119), not converted to the visitor's local currency
    adaptive_pricing: { enabled: false },
    line_items: [{ price, quantity: 1 }],
    customer: customerId,
    client_reference_id: current.id,
    metadata: { profileId: current.id, tier, interval, ...(pending ? { redemptionId: pending.id } : {}) },
    subscription_data: { metadata: { profileId: current.id, tier }, ...(trial ? { trial_period_days: TRIAL_DAYS } : {}) },
    // A card is asked for, so the trial continues as a paid plan (test card 4242 4242 4242 4242).
    // Free months from the shop (a 100% code) need no card: Stripe then collects one only if something is due.
    payment_method_collection: pendingReward?.kind === 'pro_months' ? 'if_required' : 'always',
    success_url: `${origin}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing?canceled=1`,
  };
  const create = (params: Stripe.Checkout.SessionCreateParams) => getStripe().checkout.sessions.create(params);
  const withCode: Stripe.Checkout.SessionCreateParams = pending?.promotionCodeId
    ? { ...base, discounts: [{ promotion_code: pending.promotionCodeId }] }
    : { ...base, allow_promotion_codes: true };

  const session = await stripeCall('checkout session', async () => {
    try {
      return await create(withCode);
    } catch (err) {
      // The stored code is no longer usable (used up or turned off in Stripe): check out without it.
      if (!pending || (stripeCode(err) !== 'resource_missing' && !/promotion/i.test((err as Error).message))) throw err;
      console.error(`[billing] stored promotion code ${pending.promotionCodeId} was refused; checkout continues without it`);
      return create({ ...base, payment_method_collection: 'always', allow_promotion_codes: true });
    }
  });
  if (!session.url) throw new HttpError(502, 'payment_provider_error', 'Stripe returned no Checkout URL.');
  return { url: session.url, id: session.id };
}

const SESSION_RE = /^cs_test_[A-Za-z0-9]{10,200}$/;

/**
 * GET /api/billing/confirm: the finished Checkout of this profile → plan `trialing`/`pro` with the
 * period end and Stripe ids; the shop code used in it becomes `applied`. Repeatable.
 */
export async function confirmCheckout(profile: Profile, sessionId: string, now: Date = new Date()): Promise<{ plan: Profile['plan'] }> {
  if (!SESSION_RE.test(sessionId)) throw new HttpError(400, 'invalid_input', 'session_id: not a Checkout Session id');
  const session = await stripeCall('checkout confirm', async (s) => {
    try {
      return await s.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
    } catch (err) {
      if (stripeCode(err) === 'resource_missing') throw new HttpError(404, 'not_found', 'No such checkout.');
      throw err;
    }
  });
  const owner = session.metadata?.profileId ?? session.client_reference_id;
  if (owner !== profile.id) throw new HttpError(404, 'not_found', 'No such checkout.');
  if (session.status !== 'complete') throw new HttpError(409, 'checkout_open', 'This checkout is not finished yet.', { status: session.status });
  const sub = await subscriptionOf(getStripe(), session.subscription);
  if (!sub) throw new HttpError(502, 'payment_provider_error', 'The checkout has no subscription.');

  const plan = planFromSubscription(sub, now);
  const usedPromos = new Set((session.discounts ?? []).map((d) => (typeof d.promotion_code === 'string' ? d.promotion_code : d.promotion_code?.id)).filter(Boolean));
  const usedRedemption = session.metadata?.redemptionId;
  const at = now.toISOString();
  const { profile: saved } = await updateProfile(
    profile.id,
    (p) => {
      p.plan = { ...p.plan, ...plan };
      p.redemptions = p.redemptions.map((r) =>
        r.status === 'issued' && ((r.promotionCodeId && usedPromos.has(r.promotionCodeId)) || (r.id === usedRedemption && usedPromos.size > 0))
          ? { ...r, status: 'applied', appliedTo: 'checkout', appliedAt: at }
          : r,
      );
    },
    { current: profile },
  );
  return { plan: saved.plan };
}

async function subscriptionOf(s: BillingStripe, ref: string | Stripe.Subscription | null): Promise<Stripe.Subscription | null> {
  if (!ref) return null;
  if (typeof ref !== 'string') return ref;
  return stripeCall('subscription', () => s.subscriptions.retrieve(ref));
}

/** Our portal configuration (made by stripe:setup, `metadata.app = irreplaceable`), else the account default. */
let portalConfig: { id: string | null; at: number } | null = null;
async function portalConfiguration(s: BillingStripe): Promise<string | undefined> {
  if (portalConfig && Date.now() - portalConfig.at < PRICE_TTL_MS) return portalConfig.id ?? undefined;
  const list = await s.billingPortal.configurations.list({ active: true, limit: 20 });
  const ours = list.data.find((c) => c.metadata?.app === 'irreplaceable');
  portalConfig = { id: ours?.id ?? null, at: Date.now() };
  return ours?.id;
}

export async function createPortal(profile: Profile, origin: string, returnPath: string): Promise<{ url: string }> {
  const customer = profile.plan.stripeCustomerId;
  if (!customer) throw new HttpError(404, 'no_subscription', 'There is no Stripe billing for this profile yet.');
  const session = await stripeCall('billing portal', async (s) => {
    const configuration = await portalConfiguration(s);
    return s.billingPortal.sessions.create({ customer, return_url: `${origin}${returnPath}`, ...(configuration ? { configuration } : {}) });
  });
  return { url: session.url };
}

/**
 * A plan change on a running Stripe subscription, through the Billing Portal's confirm page for this one
 * subscription (never a second Checkout). Pro → Max is charged now for the difference only (the portal
 * configuration prorates with `always_invoice`); Max → Pro is scheduled for the end of the period
 * (`schedule_at_period_end` for decreasing amounts), so the person keeps Max until renewal. The interval
 * stays as it is. 409 no_subscription without a running subscription, 409 same_plan when it is that tier.
 */
export async function createPlanChange(profile: Profile, tier: Tier, origin: string, now: Date = new Date()): Promise<{ url: string }> {
  const { subscriptionId, stripeCustomerId: customer } = profile.plan;
  if (!stripeActive(profile.plan, now) || !subscriptionId || !customer) {
    throw new HttpError(409, 'no_subscription', 'There is no running subscription to change.');
  }
  if (tierOf(profile.plan) === tier) throw new HttpError(409, 'same_plan', 'You are already on this plan.');
  const sub = await stripeCall('subscription', (s) => s.subscriptions.retrieve(subscriptionId));
  const item = sub.items.data[0];
  if (!item) throw new HttpError(502, 'payment_provider_error', 'The subscription has no plan item.');
  const interval: BillingInterval = item.price.recurring?.interval === 'year' ? 'year' : 'month';
  const price = await priceFor(interval, tier);
  const back = `${origin}/pricing?portal=1`;
  const session = await stripeCall('billing portal', async (s) => {
    const configuration = await portalConfiguration(s);
    return s.billingPortal.sessions.create({
      customer,
      return_url: back,
      ...(configuration ? { configuration } : {}),
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: { subscription: sub.id, items: [{ id: item.id, price, quantity: 1 }] },
        after_completion: { type: 'redirect', redirect: { return_url: back } },
      },
    });
  });
  return { url: session.url };
}
