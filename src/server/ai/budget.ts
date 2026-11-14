import { createHash } from 'node:crypto';
import { getGlobalStore, getStore } from '@/server/store';

/**
 * Money and rate limits for model calls.
 *
 * The budget is never checked-then-spent: each call first *reserves* its worst-case cost with an
 * atomic INCRBYFLOAT on `budget:total` and `budget:<day>`. If either counter goes over its limit the
 * reservation is rolled back and the call is refused, so parallel calls cannot jointly overspend.
 * After the call the reservation is settled to the real `usage.cost`.
 *
 * Spend counters are GLOBAL (`irr:global:budget:*`): there is one OpenRouter key (~$12) behind local
 * scripts, preview and production, so they all draw from the same total and the same daily cap.
 * `AI_BUDGET_USD` is the cap on that global total as seen by the environment that reads it: local
 * development uses a lower value (e.g. 3) so scripts stop early, and production should set it to the
 * credit that may still be spent in total (the key's remaining credit plus what is already counted).
 * Per-profile and per-IP rate limits stay per environment (`rl:*` in the environment's namespace).
 */

export interface Actor {
  profileId?: string | null;
  ip?: string | null;
  /** Per-day cap for this profile bucket when it differs from the default (e.g. calls inside a practice rep). */
  profilePerDay?: number;
}

/**
 * Default per-day model-call limits, set high on purpose: judges and visitors share one network (one IP) and must
 * be able to try everything freely. The money is protected by the global and daily dollar caps, not by these.
 * Override with AI_PROFILE_PER_DAY / AI_IP_PER_DAY. Title translation has its own bucket (src/server/xray/search.ts).
 */
export const RATE_LIMITS = { profilePerDay: 300, ipPerDay: 20000 } as const;
const RATE_TTL_SEC = 2 * 24 * 3600;
const DAY_TTL_SEC = 3 * 24 * 3600;

export interface BudgetStatus {
  totalUsd: number;
  dayUsd: number;
  totalLimitUsd: number;
  dayLimitUsd: number;
  day: string;
}

export interface Denial {
  code: 'budget_exceeded' | 'rate_limited';
  reason: string;
}

export interface Reservation {
  readonly amountUsd: number;
  readonly day: string;
  /** Replaces the reserved amount with the real cost; returns the counters after settling. */
  settle(actualUsd: number): Promise<BudgetStatus>;
  /** Returns the whole reservation (the call did not happen or was not billed). */
  release(): Promise<void>;
}

function envNumber(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function budgetLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    totalLimitUsd: envNumber(env.AI_BUDGET_USD, 6),
    dayLimitUsd: envNumber(env.AI_DAILY_CAP_USD, 2),
  };
}

/** UTC day, the unit of the daily cap and the rate-limit windows. */
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function hashIp(ip: string): string {
  return createHash('sha256')
    .update(`${process.env.IP_HASH_SALT ?? 'irreplaceable'}:${ip.trim()}`)
    .digest('hex')
    .slice(0, 32);
}

export const budgetKeys = {
  total: 'budget:total',
  day: (day: string) => `budget:${day}`,
  profile: (id: string, day: string) => `rl:profile:${id}:${day}`,
  ip: (ipHash: string, day: string) => `rl:ip:${ipHash}:${day}`,
};

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const store = getGlobalStore();
  const day = dayKey();
  const [totalUsd, dayUsd] = await Promise.all([store.getNumber(budgetKeys.total), store.getNumber(budgetKeys.day(day))]);
  return { totalUsd, dayUsd, day, ...budgetLimits() };
}

async function takeSlot(key: string, limit: number): Promise<boolean> {
  const store = getStore();
  const count = await store.incrFloat(key, 1, RATE_TTL_SEC);
  if (count <= limit) return true;
  await store.incrFloat(key, -1);
  return false;
}

/** Limits in force: RATE_LIMITS unless the environment overrides them (AI_PROFILE_PER_DAY, AI_IP_PER_DAY). */
export function rateLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    profilePerDay: envNumber(env.AI_PROFILE_PER_DAY, RATE_LIMITS.profilePerDay),
    ipPerDay: envNumber(env.AI_IP_PER_DAY, RATE_LIMITS.ipPerDay),
  };
}

/**
 * Counts one model call against the profile (25/day) and the IP (600/day), see rateLimits().
 * Cached answers do not reach this point and are free. Returns a denial or null.
 */
export async function consumeRateLimit(actor: Actor | undefined): Promise<Denial | null> {
  if (!actor) return null;
  const day = dayKey();
  const limits = rateLimits();
  const profileCap = actor.profilePerDay ?? limits.profilePerDay;
  if (actor.profileId && !(await takeSlot(budgetKeys.profile(actor.profileId, day), profileCap))) {
    return { code: 'rate_limited', reason: `profile reached ${profileCap} model calls today` };
  }
  if (actor.ip && !(await takeSlot(budgetKeys.ip(hashIp(actor.ip), day), limits.ipPerDay))) {
    return { code: 'rate_limited', reason: `IP reached ${limits.ipPerDay} model calls today` };
  }
  return null;
}

export async function reserveBudget(
  estimateUsd: number,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; denial: Denial }> {
  const store = getGlobalStore();
  const { totalLimitUsd, dayLimitUsd } = budgetLimits();
  const day = dayKey();
  const dayK = budgetKeys.day(day);
  const amount = Math.max(0, estimateUsd);

  const total = await store.incrFloat(budgetKeys.total, amount);
  if (total > totalLimitUsd) {
    await store.incrFloat(budgetKeys.total, -amount);
    return {
      ok: false,
      denial: { code: 'budget_exceeded', reason: `total AI budget $${totalLimitUsd} would be exceeded (spent $${(total - amount).toFixed(4)})` },
    };
  }
  const dayTotal = await store.incrFloat(dayK, amount, DAY_TTL_SEC);
  if (dayTotal > dayLimitUsd) {
    await Promise.all([store.incrFloat(dayK, -amount), store.incrFloat(budgetKeys.total, -amount)]);
    return {
      ok: false,
      denial: { code: 'budget_exceeded', reason: `daily AI cap $${dayLimitUsd} would be exceeded (spent $${(dayTotal - amount).toFixed(4)} today)` },
    };
  }

  let done = false;
  return {
    ok: true,
    reservation: {
      amountUsd: amount,
      day,
      async settle(actualUsd: number) {
        if (done) throw new Error('reservation already settled');
        done = true;
        const delta = Math.max(0, actualUsd) - amount;
        const [t, d] = await Promise.all([store.incrFloat(budgetKeys.total, delta), store.incrFloat(dayK, delta)]);
        return { totalUsd: t, dayUsd: d, totalLimitUsd, dayLimitUsd, day };
      },
      async release() {
        if (done) return;
        done = true;
        await Promise.all([store.incrFloat(budgetKeys.total, -amount), store.incrFloat(dayK, -amount)]);
      },
    },
  };
}
