import { FREEZE_MAX, POINT_RULES } from '@/domain/points';
import type { PointsEvent, Reward } from '@/domain/types';
import { ApiError, apiFetch } from '@/lib/client/api';
import type { EarnRule, PointsData, RedeemResult, ShopData } from './types';

const isRule = (r: unknown): r is EarnRule => {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.labelKey === 'string' && typeof o.min === 'number' && typeof o.max === 'number' && !!o.limit;
};

/** GET /api/shop and GET /api/points together. A visitor without a profile gets the catalogue and an empty balance. */
export async function loadShop(): Promise<ShopData> {
  const [shop, points] = await Promise.all([
    apiFetch<{ rewards: Reward[]; freezeMax?: number }>('/api/shop'),
    apiFetch<{ balance?: number; events?: PointsEvent[]; rules?: unknown }>('/api/points').catch((err) => {
      // No profile yet: nothing earned, and the rules are the same public table for everyone.
      if (err instanceof ApiError && err.status === 401) return { balance: 0, events: [], rules: [...POINT_RULES] };
      throw err;
    }),
  ]);
  const rules = Array.isArray(points.rules) ? points.rules.filter(isRule) : [];
  const data: PointsData = { balance: points.balance ?? 0, events: points.events ?? [], rules };
  return { rewards: shop.rewards ?? [], freezeMax: shop.freezeMax ?? FREEZE_MAX, points: data };
}

/**
 * POST /api/shop/redeem. `requestId` makes a repeated press or retry return the same redemption.
 * 402 not_enough_points, 409 discount_pending / freeze_limit, 400 email_required, 502 payment_provider_error.
 */
export const redeem = (rewardId: string, email: string | undefined, requestId: string) =>
  apiFetch<RedeemResult>('/api/shop/redeem', { method: 'POST', body: { rewardId, requestId, ...(email ? { email } : {}) } });
