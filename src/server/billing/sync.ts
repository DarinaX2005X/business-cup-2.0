import type Stripe from 'stripe';
import type { Profile } from '@/domain/types';
import { updateProfile } from '@/server/profile';
import { planActive, planFromSubscription } from './plan';
import { getStripe, isStripeError } from './stripe';

/**
 * Keeps a Stripe plan current without a webhook (04.1.3): when its period has ended, the
 * subscription is read again (a trial that turned into a paid month gets a new period end; a
 * canceled one turns `free`). Reads are spaced by RECHECK_MS so an expired plan does not cost a
 * Stripe call per request. A Stripe outage keeps the stored plan (logged), it never fails the caller.
 */

export const RECHECK_MS = 10 * 60_000;
/** Forced syncs (after the Billing Portal) are spaced by this much. */
export const FORCE_MIN_MS = 10_000;

export function needsSync(plan: Profile['plan'], now: Date, force = false): boolean {
  if (plan.source === 'cup' || !plan.subscriptionId) return false;
  const since = plan.syncedAt ? now.getTime() - Date.parse(plan.syncedAt) : Infinity;
  if (force) return !(since < FORCE_MIN_MS);
  if (planActive(plan, now)) return false;
  if (plan.status === 'free' && plan.syncedAt) return false; // ended, already confirmed with Stripe
  return !(since < RECHECK_MS);
}

/** Writes the subscription's plan into the profile, if the profile still points at that subscription. */
export async function savePlanFromSubscription(profileId: string, sub: Stripe.Subscription, now: Date, opts: { current?: Profile; adopt?: boolean } = {}): Promise<Profile> {
  const next = planFromSubscription(sub, now);
  const { profile } = await updateProfile(
    profileId,
    (p) => {
      const same = p.plan.subscriptionId === sub.id && p.plan.source !== 'cup';
      if (!same && !opts.adopt) return;
      p.plan = { ...p.plan, ...next };
    },
    { current: opts.current },
  );
  return profile;
}

export async function ensureFreshPlan(profile: Profile, opts: { force?: boolean; now?: Date } = {}): Promise<Profile> {
  const now = opts.now ?? new Date();
  if (!needsSync(profile.plan, now, opts.force)) return profile;
  let sub: Stripe.Subscription;
  try {
    sub = await getStripe().subscriptions.retrieve(profile.plan.subscriptionId!);
  } catch (err) {
    if (!isStripeError(err) && !(err instanceof Error && 'status' in err)) throw err;
    console.error(`[billing] plan sync for a profile failed: ${(err as Error).message}`);
    return profile;
  }
  return savePlanFromSubscription(profile.id, sub, now, { current: profile });
}
