import { planOf, type PlanKind } from '@/components/cup/plan';
import { boardHandle, levelOf, tierOf, xpOf, type LevelInfo } from '@/domain/points';
import type { Profile } from '@/domain/types';

/**
 * What the header and the account menu show about the visitor, computed the same way on the server
 * (first paint, from the profile cookie) and on the client (live profile). Pure: safe on both sides.
 */

export type TierBadge = 'free' | 'pro' | 'coach';

export interface AccountSnapshot {
  id: string;
  balance: number;
  streakDays: string[];
  /** When the profile was created (ISO); days of this week before it are neither done nor missed. */
  createdAt: string | null;
  lastXrayId: string | null;
  jobTitle: string | null;
  nickname: string | null;
  /** The leaderboard name: the nickname, else «Nurse · 4821». */
  handle: string;
  tier: TierBadge;
  planKind: PlanKind;
  planEnd: string | null;
  level: LevelInfo;
  demo: boolean;
  /** The time zone the profile last reported (greetings on the first paint). */
  tz: string | null;
  /** The account's email; null for a guest profile (no account yet). */
  email: string | null;
}

type ProfileLike = Pick<Profile, 'id' | 'points' | 'streak' | 'createdAt' | 'lastXrayId' | 'jobTitle' | 'nickname' | 'plan' | 'demo' | 'tz'>;

/** `account: { email }` from GET /api/profile (round 3 accounts); tolerant of profiles from before it. */
function emailOf(p: unknown): string | null {
  const a = (p as { account?: { email?: unknown } | null }).account;
  return a && typeof a.email === 'string' && a.email ? a.email : null;
}

export function snapshotOf(p: ProfileLike): AccountSnapshot {
  const plan = planOf(p.plan);
  return {
    id: p.id,
    balance: p.points.balance,
    streakDays: p.streak.days,
    createdAt: p.createdAt ?? null,
    lastXrayId: p.lastXrayId ?? null,
    jobTitle: p.jobTitle?.trim() || null,
    nickname: p.nickname?.trim() || null,
    handle: boardHandle(p),
    tier: plan.active ? tierOf(p.plan) : 'free',
    planKind: plan.kind,
    planEnd: plan.periodEnd,
    level: levelOf(xpOf(p)),
    demo: Boolean(p.demo),
    tz: p.tz ?? null,
    email: emailOf(p),
  };
}

/** The letter on the avatar: the first letter or digit of the handle. */
export function initialOf(s: Pick<AccountSnapshot, 'handle'>): string {
  const m = s.handle.match(/[\p{L}\p{N}]/u);
  return (m?.[0] ?? '·').toUpperCase();
}

/** Monday-first week of the visitor's local calendar: which days have practice, today's index, and the first day the profile existed. */
export function streakWeekOf(days: string[], createdAt: string | null, now: Date = new Date()): { done: boolean[]; today: number; since: number; count: number } {
  const today = (now.getDay() + 6) % 7;
  const set = new Set(days);
  const done = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - today + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return set.has(key);
  });
  let since = 0;
  if (createdAt) {
    const c = new Date(createdAt);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - today);
    const created = new Date(c.getFullYear(), c.getMonth(), c.getDate());
    since = Math.max(0, Math.min(today, Math.round((created.getTime() - monday.getTime()) / 86_400_000)));
  }
  return { done, today, since, count: done.filter(Boolean).length };
}

/** Where the account menu leads. The profile page owns the anchors (REQUESTS «R3 shell»). */
export const ACCOUNT_LINKS = {
  profile: '/profile',
  subscription: '/profile#subscription',
  settings: '/profile#settings',
  leaderboard: '/leaderboard',
  method: '/method',
  pricing: '/pricing',
  shop: '/shop',
  progress: '/progress',
  home: '/home',
} as const;
