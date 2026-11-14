import { cupOfferOpen as domainCupOfferOpen } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';

/**
 * Business Cup 2.0 offer (04.1.4): Pro for 30 days without payment. The rule and its date live in
 * src/domain/points.ts (the server answers 410 `offer_ended` after it); the client words the offer from
 * the same constants and stops showing it once the date has passed.
 */
export { CUP_OFFER_UNTIL, CUP_PRO_DAYS } from '@/domain/points';
export const cupOfferOpen = (now: number = Date.now()) => domainCupOfferOpen(new Date(now));

/** The profile's plan; `source: 'cup'` marks the Business Cup unlock. */
export type ProfilePlan = Profile['plan'];

export type PlanKind = 'free' | 'trialing' | 'pro' | 'cup';

export interface PlanView {
  kind: PlanKind;
  /** Pro features are open right now. */
  active: boolean;
  periodEnd: string | null;
  /** Paid or trialing through Stripe (the Billing Portal applies). */
  stripe: boolean;
}

/** How a profile's plan reads in the interface. Mirrors the server's isPro: an ended period is Free. */
export function planOf(plan: ProfilePlan | null | undefined, now: number = Date.now()): PlanView {
  if (!plan || (plan.status !== 'pro' && plan.status !== 'trialing')) return { kind: 'free', active: false, periodEnd: null, stripe: false };
  const end = plan.periodEnd ? Date.parse(plan.periodEnd) : NaN;
  const active = Number.isFinite(end) && end > now;
  if (!active) return { kind: 'free', active: false, periodEnd: plan.periodEnd ?? null, stripe: false };
  if (plan.source === 'cup') return { kind: 'cup', active, periodEnd: plan.periodEnd ?? null, stripe: false };
  return { kind: plan.status === 'trialing' ? 'trialing' : 'pro', active, periodEnd: plan.periodEnd ?? null, stripe: true };
}

/** POST /api/billing/cup: idempotent, needs a profile. 409 `already_pro`, 410 `offer_ended`. */
export const unlockCup = () => apiFetch<{ plan: ProfilePlan }>('/api/billing/cup', { method: 'POST' });
