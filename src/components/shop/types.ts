import type { PointsRule } from '@/domain/points';
import type { PointsEvent, Redemption, Reward } from '@/domain/types';

/**
 * Client view of the 04.1 points and shop API (PLAN «Контракты»): GET /api/points, GET /api/shop,
 * POST /api/shop/redeem. The earning rules are the server's own rows (src/domain/points.ts POINT_RULES):
 * their `labelKey` and limits drive «How to earn».
 */

export type EarnRule = PointsRule;

export interface PointsData {
  balance: number;
  events: PointsEvent[];
  rules: EarnRule[];
}

export interface ShopData {
  rewards: Reward[];
  /** Streak freezes a profile can hold at once. */
  freezeMax: number;
  points: PointsData;
}

export interface RedeemResult {
  redemption: Redemption;
  balance: number;
}

export type { Redemption, Reward };
