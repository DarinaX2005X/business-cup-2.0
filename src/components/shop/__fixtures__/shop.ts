import { FREEZE_MAX, POINT_RULES, REWARDS as CATALOG } from '@/domain/points';
import type { Profile, Redemption } from '@/domain/types';
import type { ShopData } from '../types';

/**
 * Stored screen states of /shop for development (`/shop?fixture=<name>`). Production never reads them:
 * the page passes a fixture only when NODE_ENV is not production. The catalogue and rules are the
 * server's own constants (src/domain/points.ts).
 */

export interface ShopFixture {
  data: ShopData;
  redemptions: Redemption[];
  freezes: number;
  plan: Profile['plan'];
}

const REWARDS = [...CATALOG];
const RULES = [...POINT_RULES];

const FREE: Profile['plan'] = { status: 'free' };
const at = (d: string) => `${d}T10:12:00.000Z`;

function fx(balance: number, redemptions: Redemption[] = [], freezes = 0, plan: Profile['plan'] = FREE): ShopFixture {
  return { data: { rewards: REWARDS, freezeMax: FREEZE_MAX, points: { balance, events: [], rules: RULES } }, redemptions, freezes, plan };
}

export const shopFixtures: Record<string, ShopFixture> = {
  /** A brand-new profile: nothing earned yet. */
  fresh: fx(0),
  /** Right after the first session (map, week, first rep, trial rep, AI or me): the first reward is reachable. */
  'first-session': fx(265),
  /** A few weeks in: a 10% code used, one freeze in stock, saving toward 50% off. */
  saving: fx(3480, [{ id: 'r1', rewardId: 'pro_10', cost: 250, status: 'applied', code: 'IRR-4HTP-K2QM', at: at('2026-10-21') }, { id: 'r2', rewardId: 'streak_freeze', cost: 400, status: 'applied', at: at('2026-11-02') }], 1),
  /** A code waiting for checkout and a partner gift requested. */
  issued: fx(
    1810,
    [
      { id: 'r3', rewardId: 'claude_pro_1m', cost: 25000, status: 'requested', email: 'you@example.com', at: at('2026-11-09') },
      { id: 'r4', rewardId: 'pro_10', cost: 250, status: 'issued', code: 'IRR-7KQ2-M9XD', at: at('2026-11-13') },
    ],
    2,
  ),
  /** A long-time Pro member with enough for a year. */
  pro: fx(
    61240,
    [
      { id: 'r5', rewardId: 'pro_3m', cost: 24000, status: 'applied', code: 'IRR-Q8WE-3NLA', at: at('2026-08-30') },
      { id: 'r6', rewardId: 'chatgpt_plus_1m', cost: 25000, status: 'sent', email: 'you@example.com', code: 'GPT-PLUS-2Y7H', at: at('2026-10-04') },
    ],
    0,
    { status: 'pro', periodEnd: '2026-12-30T00:00:00.000Z', stripeCustomerId: 'cus_test', subscriptionId: 'sub_test' },
  ),
};
