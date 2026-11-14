import type Stripe from 'stripe';
import { CUP_OFFER_ENDS_AT, tierOf, tierOfLookupKey, type Tier } from '@/domain/points';
import type { Profile } from '@/domain/types';

/**
 * The plan check behind `isPro` (src/server/profile) and the mapping from a Stripe subscription.
 * Pure on purpose: `src/server/profile` imports it, so it must not import the profile store back.
 * Re-reading an expired Stripe plan lives in `./sync.ts`.
 */

export type Plan = Profile['plan'];

/** Pro access: a `pro`/`trialing` plan whose period has not ended, whatever its source (Stripe or the Cup offer). */
export function planActive(plan: Plan, now: Date = new Date()): boolean {
  if (plan.status !== 'pro' && plan.status !== 'trialing') return false;
  if (!plan.periodEnd) return false;
  const end = Date.parse(plan.periodEnd);
  return Number.isFinite(end) && end > now.getTime();
}

/**
 * Coach access (round 3): an active plan on the Coach tier (the Cup offer is Coach; plans from before
 * the tier existed are Pro), or DEV_FORCE_COACH=1 outside production. Pro access (`isPro` in
 * src/server/profile) is true for both tiers.
 */
export function isCoach(profile: Pick<Profile, 'plan'>, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEV_FORCE_COACH === '1' && env.NODE_ENV !== 'production' && env.VERCEL_ENV !== 'production') return true;
  return planActive(profile.plan, now) && tierOf(profile.plan) === 'coach';
}

/** Stripe products by tier (created by `npm run stripe:setup`). */
export const STRIPE_PRODUCTS: Record<Tier, string> = { pro: 'irr_pro', coach: 'irr_coach' };

/** Tier of a subscription: its price's lookup_key, else its product, else `metadata.tier`, else Pro. */
export function tierOfSubscription(sub: Stripe.Subscription): Tier {
  const price = sub.items?.data?.[0]?.price;
  const byKey = tierOfLookupKey(price?.lookup_key);
  if (byKey) return byKey;
  const product = typeof price?.product === 'string' ? price.product : price?.product?.id;
  if (product === STRIPE_PRODUCTS.coach) return 'coach';
  if (product === STRIPE_PRODUCTS.pro) return 'pro';
  return sub.metadata?.tier === 'coach' ? 'coach' : 'pro';
}

/** An active plan paid through Stripe (subscription or its trial). */
export function stripeActive(plan: Plan, now: Date = new Date()): boolean {
  return plan.source !== 'cup' && Boolean(plan.subscriptionId) && planActive(plan, now);
}

const iso = (sec: number | null | undefined) => (typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : undefined);

/**
 * Plan fields from a subscription: trialing → `trialing` until `trial_end`; active or past_due
 * (Stripe is still retrying the card) → `pro` until the item's `current_period_end`; anything else
 * (canceled, unpaid, incomplete, paused) → `free`. A scheduled cancel ends access at `cancel_at`.
 */
export function planFromSubscription(sub: Stripe.Subscription, now: Date = new Date()): Plan {
  const item = sub.items?.data?.[0];
  const status: Plan['status'] = sub.status === 'trialing' ? 'trialing' : sub.status === 'active' || sub.status === 'past_due' ? 'pro' : 'free';
  let end = sub.status === 'trialing' ? (sub.trial_end ?? item?.current_period_end) : item?.current_period_end;
  if (sub.cancel_at && (!end || sub.cancel_at < end)) end = sub.cancel_at;
  if (status === 'free') end = sub.ended_at ?? sub.canceled_at ?? end;
  const recurring = item?.price?.recurring?.interval;
  const interval: Plan['interval'] = recurring === 'month' ? 'month' : recurring === 'year' ? 'year' : undefined;
  return {
    status,
    periodEnd: iso(end),
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    subscriptionId: sub.id,
    source: 'stripe',
    tier: tierOfSubscription(sub),
    ...(interval ? { interval } : {}),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    syncedAt: now.toISOString(),
  };
}

/**
 * The Business Cup 2.0 plan (round 3): Coach, free, until the offer ends (end of November 30 anywhere on
 * Earth), no payment. Stripe ids (if any) are kept.
 */
export function cupPlan(prev: Plan, now: Date): Plan {
  const end = Math.max(Date.parse(CUP_OFFER_ENDS_AT), now.getTime());
  return {
    status: 'pro',
    source: 'cup',
    tier: 'coach',
    periodEnd: new Date(end).toISOString(),
    ...(prev.stripeCustomerId ? { stripeCustomerId: prev.stripeCustomerId } : {}),
    ...(prev.subscriptionId ? { subscriptionId: prev.subscriptionId } : {}),
  };
}
