import { PRO_PRICES, TRIAL_DAYS } from '@/domain/points';
import type { Redemption } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';
import type { ProfilePlan } from '@/components/cup/plan';

/** Prices of the Stripe products (src/domain/points.ts PRO_PRICES, lookup keys pro_monthly and pro_yearly). */
export const PRO_MONTHLY_USD = PRO_PRICES.month.usd;
export const PRO_YEARLY_USD = PRO_PRICES.year.usd;
export { TRIAL_DAYS };
/** What yearly billing saves against twelve monthly payments: $228 − $119. */
export const YEARLY_SAVING_USD = PRO_MONTHLY_USD * 12 - PRO_YEARLY_USD;

export type Interval = 'year' | 'month';

/** POST /api/billing/checkout: a Stripe Checkout URL (trial, test mode, an issued shop code applied). */
export const startCheckout = (interval: Interval) => apiFetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { interval } });

/** POST /api/billing/portal: Stripe Billing Portal for cancelling or changing the card; it returns to /pricing?portal=1. */
export const openPortal = () => apiFetch<{ url: string }>('/api/billing/portal', { method: 'POST', body: { returnPath: '/pricing?portal=1' } });

/** GET /api/billing/plan?sync=1: re-reads the subscription from Stripe after the Billing Portal. */
export const syncPlan = () => apiFetch<{ plan: ProfilePlan; isPro: boolean }>('/api/billing/plan?sync=1');

/** GET /api/billing/confirm: the plan after Checkout returned to /pro/success. */
export const confirmCheckout = (sessionId: string) => apiFetch<{ plan: ProfilePlan }>(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`);

/** A shop code waiting for the next checkout: `pro_10` → 10 % off, `pro_3m` → 3 months. */
export function pendingProCode(redemptions: readonly Redemption[] | undefined): { percent: number } | { months: number } | null {
  const r = [...(redemptions ?? [])].reverse().find((x) => x.status === 'issued' && x.rewardId.startsWith('pro_'));
  if (!r) return null;
  const months = /^pro_(\d+)m$/.exec(r.rewardId);
  if (months) return { months: Number(months[1]) };
  const percent = /^pro_(\d+)$/.exec(r.rewardId);
  return percent ? { percent: Number(percent[1]) } : null;
}
