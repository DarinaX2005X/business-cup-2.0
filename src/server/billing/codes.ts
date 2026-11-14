import { randomInt } from 'node:crypto';
import type Stripe from 'stripe';
import type { Reward } from '@/domain/types';
import { stripeCall, stripeCode, type BillingStripe } from './stripe';

/**
 * Stripe coupons and one-use promotion codes behind the pro_* rewards (04.1.2).
 * Coupons are created once per reward under a fixed id `irr_<rewardId>` (with `metadata.reward_id`),
 * so `retrieve` finds them without listing; `stripe:setup` creates them ahead, redeem creates a
 * missing one on demand. Discounts are `once` (the first payment); months are 100% `repeating`.
 */

export const couponId = (rewardId: string) => `irr_${rewardId}`;

export function couponParams(reward: Reward): Stripe.CouponCreateParams {
  if (!reward.percentOff) throw new Error(`reward ${reward.id} has no percent_off`);
  const months = reward.kind === 'pro_months' ? reward.months : undefined;
  return {
    id: couponId(reward.id),
    percent_off: reward.percentOff,
    duration: months ? 'repeating' : 'once',
    ...(months ? { duration_in_months: months } : {}),
    name: months ? `Points reward: ${months} ${months === 1 ? 'month' : 'months'} of Pro` : `Points reward: ${reward.percentOff}% off`,
    metadata: { reward_id: reward.id, app: 'irreplaceable' },
  };
}

/** The coupon id for this reward, creating the coupon on first use. */
export async function ensureCoupon(s: BillingStripe, reward: Reward): Promise<string> {
  const id = couponId(reward.id);
  try {
    const found = await s.coupons.retrieve(id);
    if (found.valid !== false) return found.id;
    throw new Error(`coupon ${id} exists but is no longer valid; delete it in the Stripe dashboard and run stripe:setup`);
  } catch (err) {
    if (stripeCode(err) !== 'resource_missing') throw err;
  }
  try {
    return (await s.coupons.create(couponParams(reward))).id;
  } catch (err) {
    if (stripeCode(err) === 'resource_already_exists') return id; // created in parallel
    throw err;
  }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const newPromoCode = () => `IRR-${block()}-${block()}`;
export const PROMO_RE = /^IRR-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/**
 * A one-use promotion code `IRR-XXXX-XXXX` for the reward's coupon, tagged with the profile and the
 * redemption. No idempotency key: the code is random, and a repeated redeem request is answered from
 * the profile before Stripe is called (a parallel duplicate is deactivated by the caller).
 */
export async function createPromotionCode(reward: Reward, profileId: string, redemptionId: string): Promise<{ id: string; code: string }> {
  return stripeCall('promotion code', async (s) => {
    const coupon = await ensureCoupon(s, reward);
    for (let attempt = 0; ; attempt++) {
      try {
        const promo = await s.promotionCodes.create({
          promotion: { type: 'coupon', coupon },
          code: newPromoCode(),
          max_redemptions: 1,
          metadata: { profileId, rewardId: reward.id, redemptionId },
        });
        return { id: promo.id, code: promo.code };
      } catch (err) {
        // the random code is taken (practically never): try another one
        if (attempt < 2 && stripeCode(err) === 'resource_already_exists') continue;
        throw err;
      }
    }
  });
}

/** Turns a code off (rollback when the redemption could not be saved). Best effort, logged. */
export async function deactivatePromotionCode(id: string): Promise<void> {
  try {
    await stripeCall('promotion code rollback', (s) => s.promotionCodes.update(id, { active: false }));
  } catch (err) {
    console.error(`[billing] could not deactivate promotion code ${id}: ${(err as Error).message}`);
  }
}

/**
 * Adds the code to a running subscription, keeping the discounts it already has (Stripe replaces
 * the whole list on update). Returns the previous list for a rollback.
 */
export async function applyToSubscription(subscriptionId: string, promotionCodeId: string): Promise<{ previous: string[] }> {
  return stripeCall('subscription discount', async (s) => {
    const sub = await s.subscriptions.retrieve(subscriptionId);
    const previous = (sub.discounts ?? []).map((d) => (typeof d === 'string' ? d : d.id));
    await s.subscriptions.update(subscriptionId, { discounts: [...previous.map((discount) => ({ discount })), { promotion_code: promotionCodeId }] });
    return { previous };
  });
}

export async function restoreSubscriptionDiscounts(subscriptionId: string, previous: string[]): Promise<void> {
  try {
    await stripeCall('subscription discount rollback', (s) => s.subscriptions.update(subscriptionId, { discounts: previous.length ? previous.map((discount) => ({ discount })) : '' }));
  } catch (err) {
    console.error(`[billing] could not restore discounts on ${subscriptionId}: ${(err as Error).message}`);
  }
}
