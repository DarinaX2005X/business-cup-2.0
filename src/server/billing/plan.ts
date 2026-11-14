import type Stripe from 'stripe';
import { CUP_PRO_DAYS } from '@/domain/points';
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
    ...(interval ? { interval } : {}),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    syncedAt: now.toISOString(),
  };
}

/** The Business Cup 2.0 plan: Pro for CUP_PRO_DAYS from `now`, no payment. Stripe ids (if any) are kept. */
export function cupPlan(prev: Plan, now: Date): Plan {
  return {
    status: 'pro',
    source: 'cup',
    periodEnd: new Date(now.getTime() + CUP_PRO_DAYS * 86_400_000).toISOString(),
    ...(prev.stripeCustomerId ? { stripeCustomerId: prev.stripeCustomerId } : {}),
    ...(prev.subscriptionId ? { subscriptionId: prev.subscriptionId } : {}),
  };
}
