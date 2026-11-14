import { randomBytes } from 'node:crypto';
import { FREEZE_MAX, isProReward, pendingProCode, redeemBlock, rewardById, spend, type RedeemBlock } from '@/domain/points';
import type { Profile, Redemption, Reward } from '@/domain/types';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { applyToSubscription, createPromotionCode, deactivatePromotionCode, restoreSubscriptionDiscounts } from './codes';
import { stripeActive } from './plan';

/**
 * POST /api/shop/redeem (04.1.2). Order of work, so that points are never spent without a reward:
 *   1. checks (reward, balance, one issued Pro code at a time, freeze stock, partner email);
 *   2. Stripe side effects for pro_* rewards: promotion code, and for a running subscription the
 *      discount is added to it (`applied`), otherwise the code waits for the next Checkout (`issued`);
 *   3. one profile write that re-checks everything, spends the points and records the redemption.
 * A Stripe failure stops at step 2 with nothing spent. If step 3 loses a race (two tabs spending the
 * same points), the Stripe changes are rolled back. A repeated `requestId` returns the first result.
 */

export interface RedeemInput {
  rewardId: string;
  email?: string;
  /** Client id of this redeem click (retries and double clicks reuse it). */
  requestId?: string;
}

export interface RedeemResult {
  redemption: Redemption;
  balance: number;
  /** false when the same requestId was already redeemed (nothing new spent) */
  created: boolean;
}

const MESSAGES: Record<RedeemBlock, string> = {
  not_enough_points: 'Not enough points for this reward yet.',
  discount_pending: 'You already have a Pro code waiting for checkout. Use it first, then redeem the next one.',
  freeze_limit: `You already hold ${FREEZE_MAX} streak freezes, the most you can keep.`,
  not_available: 'This reward is not available yet.',
};

function blockError(profile: Profile, reward: Reward, block: RedeemBlock): HttpError {
  if (block === 'not_enough_points') return new HttpError(402, block, MESSAGES[block], { need: (reward.cost ?? 0) - profile.points.balance, balance: profile.points.balance });
  if (block === 'discount_pending') return new HttpError(409, block, MESSAGES[block], { redemption: pendingProCode(profile) });
  if (block === 'freeze_limit') return new HttpError(409, block, MESSAGES[block], { freezes: profile.streak.freezes });
  return new HttpError(400, block, MESSAGES[block]);
}

const redemptionIdFor = (requestId?: string) => `rd_${requestId ?? randomBytes(9).toString('base64url')}`;

export async function redeem(profile: Profile, input: RedeemInput, now: Date = new Date()): Promise<RedeemResult> {
  const reward = rewardById(input.rewardId);
  if (!reward) throw new HttpError(400, 'unknown_reward', `No reward "${input.rewardId}".`);
  const id = redemptionIdFor(input.requestId);
  const replay = profile.redemptions.find((r) => r.id === id);
  if (replay) return { redemption: replay, balance: profile.points.balance, created: false };

  const block = redeemBlock(profile, reward);
  if (block) throw blockError(profile, reward, block);
  const email = input.email?.trim();
  if (reward.kind === 'partner_gift' && !email) throw new HttpError(400, 'email_required', 'Add the email where we should send your code.');

  const at = now.toISOString();
  let redemption: Redemption = { id, rewardId: reward.id, cost: reward.cost!, status: 'applied', at };
  let promoId: string | null = null;
  let subRollback: { subscriptionId: string; previous: string[] } | null = null;

  if (isProReward(reward)) {
    const promo = await createPromotionCode(reward, profile.id, id);
    promoId = promo.id;
    redemption = { ...redemption, status: 'issued', code: promo.code, promotionCodeId: promo.id };
    if (stripeActive(profile.plan, now)) {
      try {
        const { previous } = await applyToSubscription(profile.plan.subscriptionId!, promo.id);
        subRollback = { subscriptionId: profile.plan.subscriptionId!, previous };
      } catch (err) {
        await deactivatePromotionCode(promo.id);
        throw err;
      }
      redemption = { ...redemption, status: 'applied', appliedTo: 'subscription', appliedAt: at };
    }
  } else if (reward.kind === 'partner_gift') {
    redemption = { ...redemption, status: 'requested', email };
  }

  try {
    const { profile: saved } = await updateProfile(
      profile.id,
      (p) => {
        if (p.redemptions.some((r) => r.id === id)) return;
        const again = redeemBlock(p, reward);
        if (again) throw blockError(p, reward, again);
        const next = spend(p, reward.cost!, id, at);
        if (!next) throw blockError(p, reward, 'not_enough_points');
        next.redemptions = [...p.redemptions, redemption];
        if (reward.kind === 'streak_freeze') next.streak = { ...p.streak, freezes: p.streak.freezes + 1 };
        return next;
      },
      { current: profile },
    );
    const stored = saved.redemptions.find((r) => r.id === id) ?? redemption;
    if (stored !== redemption && stored.promotionCodeId !== promoId) {
      // a parallel duplicate of this request saved first: keep its code, drop ours
      if (subRollback) await restoreSubscriptionDiscounts(subRollback.subscriptionId, subRollback.previous);
      if (promoId) await deactivatePromotionCode(promoId);
      return { redemption: stored, balance: saved.points.balance, created: false };
    }
    return { redemption: stored, balance: saved.points.balance, created: true };
  } catch (err) {
    if (subRollback) await restoreSubscriptionDiscounts(subRollback.subscriptionId, subRollback.previous);
    if (promoId) await deactivatePromotionCode(promoId);
    throw err;
  }
}
