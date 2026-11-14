import { addDays, daysBetween, hash32, localDay } from './reps';
import type { PointsAward, PointsEvent, PointsType, Profile, Reward } from './types';

/**
 * Points economy (04.1.1), shop catalog (04.1.2) and the money constants the UI quotes.
 * Pure: no I/O. `award` is the one place that decides how many points an action is worth;
 * the server subscriber (`src/server/points`) only passes product events to it.
 */

// ---------------------------------------------------------------------------------------------
// Earning rules (also the "How to earn" table: `labelKey` is a key of shop.<locale>.json)

export type EarnType = Exclude<PointsType, 'redeem'>;

export const REP_POINTS = {
  /** daily rep and the trial rep: base + round(perScore × score) */
  daily: { base: 20, perScore: 40 },
  /** extra reps after the daily one, counted up to `extraPerDay` a day */
  extra: { base: 10, perScore: 20 },
  extraPerDay: 3,
  perfect: 20,
  first: 50,
} as const;

export const AI_OR_ME_POINTS = { base: 10, perCorrect: 5, cards: 5 } as const;

/** Streak bonus, once each time the streak reaches the mark. */
export const STREAK_MARKS = [
  { days: 3, points: 50 },
  { days: 7, points: 150 },
  { days: 14, points: 300 },
  { days: 30, points: 700 },
  { days: 60, points: 1500 },
  { days: 100, points: 3000 },
] as const;

export type PointsLimit =
  | { kind: 'once' }
  | { kind: 'per_occupation'; count?: number }
  | { kind: 'per_iso_week' }
  | { kind: 'per_rep' }
  | { kind: 'per_streak_mark' }
  | { kind: 'per_day'; count: number }
  | { kind: 'per_days'; days: number }
  | { kind: 'total'; count: number };

export interface PointsRule {
  /** Row id; `rep_daily` and `rep_extra` are two rows of the `rep_completed` type. */
  id: string;
  type: EarnType;
  min: number;
  max: number;
  limit: PointsLimit;
  labelKey: string;
  marks?: readonly { days: number; points: number }[];
}

const rule = (id: string, type: EarnType, min: number, max: number, limit: PointsLimit, extra: Partial<PointsRule> = {}): PointsRule => ({
  id,
  type,
  min,
  max,
  limit,
  labelKey: `shop.earn.${id}`,
  ...extra,
});

/** A checked item of the 90-day plan (event `plan_item_done`, ref = item id). */
export const PLAN_ITEM_POINTS = { points: 15, perDay: 10 } as const;

/** Map awards: one per occupation, at most three in a lifetime (a pivot explorer maps a few jobs, not hundreds). */
export const XRAY_AWARDS_MAX = 3;

export const POINT_RULES: readonly PointsRule[] = [
  rule('xray_completed', 'xray_completed', 100, 100, { kind: 'per_occupation', count: XRAY_AWARDS_MAX }),
  rule('week_confirmed', 'week_confirmed', 20, 20, { kind: 'per_iso_week' }),
  rule('first_rep', 'first_rep', REP_POINTS.first, REP_POINTS.first, { kind: 'once' }),
  rule('rep_daily', 'rep_completed', REP_POINTS.daily.base, REP_POINTS.daily.base + REP_POINTS.daily.perScore, { kind: 'per_rep' }),
  rule('rep_extra', 'rep_completed', REP_POINTS.extra.base, REP_POINTS.extra.base + REP_POINTS.extra.perScore, { kind: 'per_day', count: REP_POINTS.extraPerDay }),
  rule('rep_perfect', 'rep_perfect', REP_POINTS.perfect, REP_POINTS.perfect, { kind: 'per_rep' }),
  rule('streak_bonus', 'streak_bonus', STREAK_MARKS[0].points, STREAK_MARKS[STREAK_MARKS.length - 1].points, { kind: 'per_streak_mark' }, { marks: STREAK_MARKS }),
  rule('ai_or_me', 'ai_or_me', AI_OR_ME_POINTS.base, AI_OR_ME_POINTS.base + AI_OR_ME_POINTS.perCorrect * AI_OR_ME_POINTS.cards, { kind: 'per_day', count: 1 }),
  rule('used_at_work', 'used_at_work', 15, 15, { kind: 'per_day', count: 3 }),
  rule('proof_shared', 'proof_shared', 25, 25, { kind: 'per_days', days: 7 }),
  rule('review_kit', 'review_kit', 50, 50, { kind: 'per_days', days: 30 }),
  rule('pivot_explored', 'pivot_explored', 15, 15, { kind: 'once' }),
  rule('invite_completed', 'invite_completed', 300, 300, { kind: 'total', count: 10 }),
  rule('invited_bonus', 'invited_bonus', 100, 100, { kind: 'once' }),
  rule('plan_item_done', 'plan_item_done', PLAN_ITEM_POINTS.points, PLAN_ITEM_POINTS.points, { kind: 'per_day', count: PLAN_ITEM_POINTS.perDay }),
];

const ruleById = (id: string) => POINT_RULES.find((r) => r.id === id)!;

/** Label of a streak award, e.g. `shop.earn.streak_bonus_7` («7-day streak»). */
export const streakLabelKey = (days: number) => `shop.earn.streak_bonus_${days}`;

// ---------------------------------------------------------------------------------------------
// award

/** What happened (a product event from `src/server/events.ts`, decoupled from the server type). */
export interface PointsTrigger {
  type: string;
  ref: string;
  data?: Record<string, unknown>;
  at: string;
}

export interface AwardResult {
  profile: Profile;
  awards: PointsAward[];
}

interface Grant {
  type: EarnType;
  ref: string;
  points: number;
  labelKey: string;
  day: string;
}

/** Event types whose limit spans the profile's whole life: never pruned from the journal. */
const LIFETIME: ReadonlySet<PointsType> = new Set(['xray_completed', 'first_rep', 'pivot_explored', 'invite_completed', 'invited_bonus', 'redeem', 'plan_item_done']);
/** Other events are kept this long: longer than the widest window (30 days, ISO week). */
export const JOURNAL_DAYS = 40;

export const eventId = (type: PointsType, ref: string) => `${type}:${ref}`;

const has = (p: Profile, type: PointsType, ref: string) => p.points.events.some((e) => e.type === type && e.ref === ref);
const ofType = (p: Profile, type: PointsType) => p.points.events.filter((e) => e.type === type);
const eventDay = (e: PointsEvent, tz: string | null) => e.day ?? localDay(new Date(e.at), tz);

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The local day an action counts for: the day in the ref when the engine put one there
 * (`<day>-<hash>` AI or me round, `<day>:<id>` work log), the rep's own day, else the local date.
 */
function dayOf(p: Profile, t: PointsTrigger): string {
  if (typeof t.data?.day === 'string' && DAY_RE.test(t.data.day)) return t.data.day.slice(0, 10);
  if ((t.type === 'ai_or_me' || t.type === 'used_at_work') && DAY_RE.test(t.ref)) return t.ref.slice(0, 10);
  if (t.type === 'rep_completed') {
    const entry = p.repLog.find((r) => r.id === t.ref);
    if (entry?.day) return entry.day;
  }
  return localDay(new Date(t.at), p.tz);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rep points for a score 0..1 (clamped). */
export function repPoints(kind: 'daily' | 'trial' | 'extra', score: number): number {
  const s = Math.min(1, Math.max(0, score));
  const r = kind === 'extra' ? REP_POINTS.extra : REP_POINTS.daily;
  return r.base + Math.round(r.perScore * s);
}

export function aiOrMePoints(correct: number): number {
  return AI_OR_ME_POINTS.base + AI_OR_ME_POINTS.perCorrect * Math.max(0, Math.min(AI_OR_ME_POINTS.cards, Math.floor(correct)));
}

function grantsFor(p: Profile, t: PointsTrigger): Grant[] {
  const day = dayOf(p, t);
  const g = (type: EarnType, ref: string, points: number, labelKey: string): Grant => ({ type, ref, points, labelKey, day });
  const out: Grant[] = [];
  const once = (type: EarnType, ref: string, points: number, labelKey: string) => {
    if (!has(p, type, ref)) out.push(g(type, ref, points, labelKey));
  };

  switch (t.type) {
    case 'xray_completed': {
      // one award per occupation, at most XRAY_AWARDS_MAX in total, so mapping hundreds of jobs cannot mint points
      if (ofType(p, 'xray_completed').length < XRAY_AWARDS_MAX) {
        once('xray_completed', t.ref, ruleById('xray_completed').max, ruleById('xray_completed').labelKey);
      }
      // the invited colleague's welcome bonus comes with their first map
      if (p.invitedBy && ofType(p, 'invited_bonus').length === 0) out.push(g('invited_bonus', p.invitedBy, 100, ruleById('invited_bonus').labelKey));
      break;
    }
    case 'week_confirmed':
      once('week_confirmed', t.ref, 20, ruleById('week_confirmed').labelKey);
      break;
    case 'rep_completed': {
      const score = num(t.data?.score);
      const kind = t.data?.kind;
      if (score === null || (kind !== 'daily' && kind !== 'trial' && kind !== 'extra')) break;
      if (has(p, 'rep_completed', t.ref)) break; // this rep has been paid for
      if (kind === 'extra') {
        const extraIds = new Set(p.repLog.filter((r) => r.kind === 'extra').map((r) => r.id));
        const paidToday = ofType(p, 'rep_completed').filter((e) => extraIds.has(e.ref) && eventDay(e, p.tz) === day).length;
        if (paidToday >= REP_POINTS.extraPerDay) break;
      } else {
        // rep_daily pays once per local day, whatever the occupation (a new map must not reopen the daily reward)
        const dailyIds = new Set(p.repLog.filter((r) => r.kind === 'daily' || r.kind === 'trial').map((r) => r.id));
        if (ofType(p, 'rep_completed').some((e) => dailyIds.has(e.ref) && eventDay(e, p.tz) === day)) break;
      }
      out.push(g('rep_completed', t.ref, repPoints(kind, score), ruleById(kind === 'extra' ? 'rep_extra' : 'rep_daily').labelKey));
      if (score >= 1) once('rep_perfect', t.ref, REP_POINTS.perfect, ruleById('rep_perfect').labelKey);
      if (ofType(p, 'first_rep').length === 0) out.push(g('first_rep', t.ref, REP_POINTS.first, ruleById('first_rep').labelKey));
      // The engine has already counted this rep into the streak when it emits rep_completed.
      // A mark pays once, when the series reaches it: the ref holds the day it was reached, and a
      // streak last extended days ago (no rep counted today) pays nothing.
      const mark = STREAK_MARKS.find((m) => m.days === p.streak.current);
      const last = p.streak.lastDay;
      if (mark && last && Math.abs(daysBetween(last, localDay(new Date(t.at), p.tz))) <= 1) {
        once('streak_bonus', `${mark.days}:${last}`, mark.points, streakLabelKey(mark.days));
      }
      break;
    }
    case 'ai_or_me': {
      const correct = num(t.data?.correct);
      if (correct === null) break;
      if (has(p, 'ai_or_me', t.ref) || ofType(p, 'ai_or_me').some((e) => eventDay(e, p.tz) === day)) break;
      out.push(g('ai_or_me', t.ref, aiOrMePoints(correct), ruleById('ai_or_me').labelKey));
      break;
    }
    case 'used_at_work': {
      if (has(p, 'used_at_work', t.ref)) break;
      if (ofType(p, 'used_at_work').filter((e) => eventDay(e, p.tz) === day).length >= 3) break;
      out.push(g('used_at_work', t.ref, 15, ruleById('used_at_work').labelKey));
      break;
    }
    case 'proof_shared':
    case 'review_kit': {
      const window = t.type === 'proof_shared' ? 7 : 30;
      if (has(p, t.type, t.ref)) break;
      if (ofType(p, t.type).some((e) => daysBetween(eventDay(e, p.tz), day) < window)) break;
      out.push(g(t.type, t.ref, ruleById(t.type).max, ruleById(t.type).labelKey));
      break;
    }
    case 'pivot_explored':
      if (ofType(p, 'pivot_explored').length === 0) out.push(g('pivot_explored', t.ref, 15, ruleById('pivot_explored').labelKey));
      break;
    case 'invite_completed':
      if (!has(p, 'invite_completed', t.ref) && ofType(p, 'invite_completed').length < 10) out.push(g('invite_completed', t.ref, 300, ruleById('invite_completed').labelKey));
      break;
    case 'plan_item_done': {
      // unchecking and checking the same item again pays nothing: the ref is the item
      if (has(p, 'plan_item_done', t.ref)) break;
      if (ofType(p, 'plan_item_done').filter((e) => eventDay(e, p.tz) === day).length >= PLAN_ITEM_POINTS.perDay) break;
      out.push(g('plan_item_done', t.ref, PLAN_ITEM_POINTS.points, ruleById('plan_item_done').labelKey));
      break;
    }
    default:
      break;
  }
  return out;
}

/** Drops windowed events older than JOURNAL_DAYS; lifetime ones (and redeems) stay. */
export function pruneJournal(events: PointsEvent[], today: string, tz: string | null): PointsEvent[] {
  const from = addDays(today, -JOURNAL_DAYS);
  return events.filter((e) => LIFETIME.has(e.type) || eventDay(e, tz) >= from);
}

/**
 * Points for one product event: applies limits and idempotency (`type:ref`), appends the journal
 * events and moves the balance. Returns the same profile object when nothing is awarded.
 */
export function award(profile: Profile, trigger: PointsTrigger): AwardResult {
  const grants = grantsFor(profile, trigger);
  if (!grants.length) return { profile, awards: [] };
  const added: PointsEvent[] = grants.map((x) => ({ id: eventId(x.type, x.ref), type: x.type, points: x.points, ref: x.ref, at: trigger.at, day: x.day }));
  const total = grants.reduce((n, x) => n + x.points, 0);
  const today = grants[0].day;
  return {
    profile: {
      ...profile,
      points: {
        balance: profile.points.balance + total,
        events: pruneJournal([...profile.points.events, ...added], today, profile.tz),
        xp: xpOf(profile) + total,
      },
    },
    awards: grants.map((x) => ({ type: x.type, points: x.points, labelKey: x.labelKey })),
  };
}

/**
 * Spends points on a redemption (negative `redeem` event). Returns null when the balance is short;
 * the balance never goes below zero. Idempotent per redemption id.
 */
export function spend(profile: Profile, cost: number, redemptionId: string, at: string): Profile | null {
  if (!Number.isInteger(cost) || cost <= 0) throw new Error(`invalid cost ${cost}`);
  if (has(profile, 'redeem', redemptionId)) return profile;
  if (profile.points.balance < cost) return null;
  const event: PointsEvent = { id: eventId('redeem', redemptionId), type: 'redeem', points: -cost, ref: redemptionId, at };
  return { ...profile, points: { balance: profile.points.balance - cost, events: [...profile.points.events, event], xp: xpOf(profile) } };
}

// ---------------------------------------------------------------------------------------------
// Shop catalog (04.1.2)

export const REWARDS: readonly Reward[] = [
  { id: 'pro_10', kind: 'pro_discount', cost: 250, percentOff: 10, titleKey: 'shop.reward.pro_10' },
  { id: 'pro_25', kind: 'pro_discount', cost: 2000, percentOff: 25, titleKey: 'shop.reward.pro_25' },
  { id: 'pro_50', kind: 'pro_discount', cost: 5000, percentOff: 50, titleKey: 'shop.reward.pro_50' },
  { id: 'pro_1m', kind: 'pro_months', cost: 9000, percentOff: 100, months: 1, titleKey: 'shop.reward.pro_1m' },
  { id: 'pro_3m', kind: 'pro_months', cost: 24000, percentOff: 100, months: 3, titleKey: 'shop.reward.pro_3m' },
  { id: 'pro_6m', kind: 'pro_months', cost: 42000, percentOff: 100, months: 6, titleKey: 'shop.reward.pro_6m' },
  { id: 'pro_12m', kind: 'pro_months', cost: 60000, percentOff: 100, months: 12, titleKey: 'shop.reward.pro_12m' },
  { id: 'claude_pro_1m', kind: 'partner_gift', cost: 25000, months: 1, partner: 'claude', titleKey: 'shop.reward.claude_pro_1m' },
  { id: 'chatgpt_plus_1m', kind: 'partner_gift', cost: 25000, months: 1, partner: 'chatgpt', titleKey: 'shop.reward.chatgpt_plus_1m' },
  { id: 'streak_freeze', kind: 'streak_freeze', cost: 400, titleKey: 'shop.reward.streak_freeze' },
  { id: 'coming_soon_1', kind: 'coming_soon', cost: null, titleKey: 'shop.reward.coming_soon' },
  { id: 'coming_soon_2', kind: 'coming_soon', cost: null, titleKey: 'shop.reward.coming_soon' },
  { id: 'coming_soon_3', kind: 'coming_soon', cost: null, titleKey: 'shop.reward.coming_soon' },
];

export const rewardById = (id: string): Reward | undefined => REWARDS.find((r) => r.id === id);
export const isProReward = (r: Pick<Reward, 'kind'>) => r.kind === 'pro_discount' || r.kind === 'pro_months';

/** Streak freezes held at most at once. */
export const FREEZE_MAX = 2;

/** A pro_* code that was issued and not yet used: only one at a time. */
export function pendingProCode(profile: Pick<Profile, 'redemptions'>) {
  return profile.redemptions.find((r) => r.status === 'issued' && isProReward(rewardById(r.rewardId) ?? { kind: 'coming_soon' }));
}

export type RedeemBlock = 'not_enough_points' | 'discount_pending' | 'freeze_limit' | 'not_available' | 'pro_only';

/** A running paid Stripe subscription on the Max tier (free Pro months cannot go onto it). */
function coachSubscribed(plan: Profile['plan'], now: Date): boolean {
  if (plan.source === 'cup' || !plan.subscriptionId || (plan.status !== 'pro' && plan.status !== 'trialing')) return false;
  return tierOf(plan) === 'coach' && Boolean(plan.periodEnd) && Date.parse(plan.periodEnd!) > now.getTime();
}

/** Why this reward cannot be redeemed now, or null. */
export function redeemBlock(profile: Profile, reward: Reward, now: Date = new Date()): RedeemBlock | null {
  if (reward.cost === null || reward.kind === 'coming_soon') return 'not_available';
  if (isProReward(reward) && pendingProCode(profile)) return 'discount_pending';
  if (reward.kind === 'pro_months' && coachSubscribed(profile.plan, now)) return 'pro_only';
  if (reward.kind === 'streak_freeze' && profile.streak.freezes >= FREEZE_MAX) return 'freeze_limit';
  if (profile.points.balance < reward.cost) return 'not_enough_points';
  return null;
}

/** The cheapest reward the balance does not reach yet ("1 240 to 25% off"), or null when everything is in reach. */
export function nextReward(balance: number): { rewardId: string; cost: number; need: number } | null {
  const next = REWARDS.filter((r) => r.cost !== null && r.cost > balance).sort((a, b) => a.cost! - b.cost!)[0];
  return next ? { rewardId: next.id, cost: next.cost!, need: next.cost! - balance } : null;
}

/** Rewards this profile can redeem right now (the "reward available" dot on Shop). */
export function availableRewards(profile: Profile): string[] {
  return REWARDS.filter((r) => redeemBlock(profile, r) === null).map((r) => r.id);
}

// ---------------------------------------------------------------------------------------------
// Streak freeze (04.1.2): one freeze covers one missed day; used automatically.

/**
 * Bridges missed days with freezes before the streak is read or extended on `day`.
 * When every missed day can be covered, the freezes are spent and `lastDay` moves to the day
 * before `day`, so `applyStreak(result.streak, day)` continues the series and `streakAsOf` keeps it.
 * Otherwise nothing changes and the streak breaks as usual (freezes stay for the next series).
 * Called by the reps engine (03.1.4): `applyStreak(applyFreeze(p.streak, day).streak, day)`.
 */
export function applyFreeze(streak: Profile['streak'], day: string): { streak: Profile['streak']; frozen: string[] } {
  if (!streak.lastDay || streak.current <= 0 || streak.freezes <= 0) return { streak, frozen: [] };
  const gap = daysBetween(streak.lastDay, day);
  if (gap <= 1) return { streak, frozen: [] };
  const missed = gap - 1;
  if (missed > streak.freezes) return { streak, frozen: [] };
  const frozen = Array.from({ length: missed }, (_, i) => addDays(streak.lastDay!, i + 1));
  return { streak: { ...streak, freezes: streak.freezes - missed, lastDay: addDays(day, -1) }, frozen };
}

// ---------------------------------------------------------------------------------------------
// Pro plan, prices and the Business Cup 2.0 offer

export const PRO_PRICES = {
  month: { usd: 19, lookupKey: 'pro_monthly' },
  year: { usd: 119, lookupKey: 'pro_yearly' },
} as const;
export type ProInterval = keyof typeof PRO_PRICES;
export const TRIAL_DAYS = 7;

/** Business Cup 2.0: Pro for free, no payment (04.1.4). The offer can be taken until the end of this date. */
export const CUP_OFFER_UNTIL = '2026-11-30';
/** End of CUP_OFFER_UNTIL anywhere on Earth (UTC−12), so "until November 30" holds in every time zone. */
export const CUP_OFFER_ENDS_AT = '2026-12-01T12:00:00.000Z';
export const CUP_PRO_DAYS = 30;

export const cupOfferOpen = (now: Date = new Date()) => now.getTime() < Date.parse(CUP_OFFER_ENDS_AT);

// ---------------------------------------------------------------------------------------------
// XP and levels (round 3): XP is every positive award ever; spending points never lowers it.

/** XP of a profile. Profiles from before XP derive it: balance plus everything spent in the shop. */
export function xpOf(profile: Pick<Profile, 'points'>): number {
  if (typeof profile.points.xp === 'number' && Number.isFinite(profile.points.xp)) return profile.points.xp;
  const spent = profile.points.events.filter((e) => e.type === 'redeem').reduce((n, e) => n - e.points, 0);
  return Math.max(0, profile.points.balance + spent);
}

/**
 * Levels on a gentle curve: the first session reaches level 2, a month of daily practice about level 6,
 * the top takes most of a year. Names are plain words about getting good at a job.
 */
export const LEVELS = [
  { level: 1, at: 0, name: 'Getting started' },
  { level: 2, at: 150, name: 'Finding your feet' },
  { level: 3, at: 400, name: 'Steady hand' },
  { level: 4, at: 800, name: 'Reliable' },
  { level: 5, at: 1400, name: 'Sharp eye' },
  { level: 6, at: 2200, name: 'Go-to person' },
  { level: 7, at: 3300, name: 'Trusted reviewer' },
  { level: 8, at: 4700, name: 'Seasoned' },
  { level: 9, at: 6500, name: 'Mentor' },
  { level: 10, at: 8800, name: 'Expert' },
  { level: 11, at: 11600, name: 'Master of the craft' },
  { level: 12, at: 15000, name: 'Irreplaceable' },
] as const;

export interface LevelInfo {
  xp: number;
  level: number;
  levelName: string;
  /** "Level 3 · Steady hand" */
  label: string;
  /** XP where this level started (for a progress bar) */
  levelAt: number;
  /** XP of the next level, null at the top */
  nextAt: number | null;
}

export function levelOf(xp: number): LevelInfo {
  const x = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let i = 0;
  while (i + 1 < LEVELS.length && LEVELS[i + 1].at <= x) i++;
  const cur = LEVELS[i];
  return { xp: x, level: cur.level, levelName: cur.name, label: `Level ${cur.level} · ${cur.name}`, levelAt: cur.at, nextAt: LEVELS[i + 1]?.at ?? null };
}

// ---------------------------------------------------------------------------------------------
// Plans and tiers (round 3): Free, Pro, Max

/**
 * Paid tiers. The top tier is shown as «Max» (the AI career coach is its main feature); its internal id
 * stays 'coach' in `plan.tier`, Stripe metadata and the checkout API.
 */
export type Tier = 'pro' | 'coach';
export type BillingInterval = 'month' | 'year';

export const TIER_PRICES: Record<Tier, { name: string } & Record<BillingInterval, { usd: number; lookupKey: string }>> = {
  pro: { name: 'Pro', ...PRO_PRICES },
  coach: { name: 'Max', month: { usd: 79, lookupKey: 'max_monthly' }, year: { usd: 479, lookupKey: 'max_yearly' } },
};

/** Display name of a tier: 'Pro' or 'Max'. */
export const tierName = (tier: Tier): string => TIER_PRICES[tier].name;

/** The paid tier of a plan: the Cup offer is Max ('coach'), older plans without a tier are Pro. */
export const tierOf = (plan: Pick<Profile['plan'], 'tier' | 'source'>): Tier => (plan.source === 'cup' ? 'coach' : (plan.tier ?? 'pro'));

/** Tier of a Stripe price by its lookup_key (`pro_monthly`, `max_yearly`, archived `coach_*` …), or null for an unknown price. */
export function tierOfLookupKey(key: string | null | undefined): Tier | null {
  if (!key) return null;
  if (key.startsWith('max_') || key.startsWith('coach_')) return 'coach';
  if (key.startsWith('pro_')) return 'pro';
  return null;
}

export interface PlanOffer {
  id: 'free' | Tier;
  name: string;
  tagline: string;
  badge: string | null;
  /** USD; null for Free */
  price: { month: number; year: number; yearPerMonth: number; savePercent: number } | null;
  /** "Everything in Free, plus:" */
  includes: 'free' | 'pro' | null;
  features: { id: string; text: string }[];
}

const priceOf = (tier: Tier): NonNullable<PlanOffer['price']> => {
  const { month, year } = TIER_PRICES[tier];
  return {
    month: month.usd,
    year: year.usd,
    yearPerMonth: Math.round((year.usd / 12) * 100) / 100,
    savePercent: Math.round((1 - year.usd / (month.usd * 12)) * 100),
  };
};

/** The three plans as /pricing shows them. Only features that exist in the product. */
export const PLANS: readonly PlanOffer[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'See where AI already fits into your week.',
    badge: null,
    price: null,
    includes: null,
    features: [
      { id: 'week_map', text: 'Your week map: what AI already does, what it speeds up, and what stays yours' },
      { id: 'ai_or_me', text: 'AI or me?, a one-minute game every day' },
      { id: 'trial_rep', text: 'One live practice rep on a task from your week' },
      { id: 'job_pages', text: 'Public pages for every job' },
      { id: 'points', text: 'Points for what you do, and the shop basics' },
    ],
  },
  {
    id: 'pro',
    name: TIER_PRICES.pro.name,
    tagline: 'Practice on your own work every day.',
    badge: 'Most popular',
    price: priceOf('pro'),
    includes: 'free',
    features: [
      { id: 'daily_reps', text: 'A daily rep on your own tasks: catch AI mistakes, hand work to AI, handle the human part, plus extra reps' },
      { id: 'plan_90', text: 'A 90-day plan, week by week, that you check off as you go' },
      { id: 'skills', text: 'Your skills from your résumé, and the gaps worth closing' },
      { id: 'next_jobs', text: 'All the jobs you could move to next' },
      { id: 'proof', text: 'A proof portfolio and a Review kit for your manager' },
      { id: 'playbook', text: 'Playbook and Second look for your real work' },
      { id: 'pdf_report', text: 'A PDF report of your week' },
      { id: 'full_shop', text: 'Points for practice and the full shop' },
    ],
  },
  {
    id: 'coach',
    name: TIER_PRICES.coach.name,
    tagline: 'A personal AI coach for your career.',
    badge: null,
    price: priceOf('coach'),
    includes: 'pro',
    features: [
      { id: 'coach_chat', text: 'Personal AI coach: chat and voice, knows your week, plan and skills' },
      { id: 'coach_checkins', text: 'Coach check-ins on your plan' },
    ],
  },
];

/** "Save up to 49%" on the yearly toggle. */
export const YEARLY_SAVE_UP_TO = Math.max(...PLANS.map((p) => p.price?.savePercent ?? 0));

// ---------------------------------------------------------------------------------------------
// Leaderboard names (round 3)

export const NICKNAME_LENGTH = { min: 2, max: 24 } as const;

/** Words a nickname may not contain (checked without spaces, with common look-alike digits read as letters). */
const BLOCKED_WORDS = ['admin', 'moderator', 'official', 'irreplaceable', 'support', 'staff', 'team', 'zimran', 'aiesec', 'jury', 'judge', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'nazi', 'hitler', 'rapist', 'porn'];
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export type NicknameCheck = { ok: true; value: string } | { ok: false; reason: 'length' | 'characters' | 'not_allowed' };

/** Trims and checks a nickname: 2–24 letters, digits, spaces and . _ ' -, starting with a letter or digit; no links, no blocked words. */
export function cleanNickname(raw: string): NicknameCheck {
  // Zero-width and other format characters are dropped first; then only basic Latin is allowed. The product is
  // English-only for the US, and a single script rules out look-alike letters (Cyrillic «а» for Latin «a») that
  // would slip past the blocked-word check or impersonate staff handles.
  const value = raw.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  if (value.length < NICKNAME_LENGTH.min || value.length > NICKNAME_LENGTH.max) return { ok: false, reason: 'length' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/.test(value)) return { ok: false, reason: 'characters' };
  const flat = value
    .toLowerCase()
    .replace(/[0-9@$]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/[^\p{L}]/gu, '');
  if (/www|https?/.test(flat) || BLOCKED_WORDS.some((w) => flat.includes(w))) return { ok: false, reason: 'not_allowed' };
  return { ok: true, value };
}

const QUALIFIERS = new Set(['senior', 'sr', 'junior', 'jr', 'staff', 'lead', 'principal', 'chief', 'head', 'registered', 'certified', 'licensed', 'entry', 'level', 'entry-level', 'mid-level', 'i', 'ii', 'iii', 'iv']);

/** A short job name for anonymous handles: «Registered Nurse» → «Nurse», «Senior Software Engineer» → «Software Engineer». */
export function shortJob(title: string | null | undefined): string {
  const base = (title ?? '').split(/[,(|/]| [-–—] /)[0].trim();
  const words = base.split(/\s+/).filter((w) => w && !QUALIFIERS.has(w.toLowerCase().replace(/\.$/, '')));
  if (!words.length) return 'Member';
  const two = words.slice(-2).join(' ');
  const pick = words.length >= 2 && two.length <= 18 ? two : words[words.length - 1];
  return (pick.charAt(0).toUpperCase() + pick.slice(1)).slice(0, 24);
}

/** The leaderboard handle: the chosen nickname, else «{short job} · {4 digits from the profile id}». */
export function boardHandle(profile: Pick<Profile, 'id' | 'jobTitle' | 'nickname'>): string {
  const digits = String(hash32(`handle:${profile.id}`) % 10_000).padStart(4, '0');
  // Both parts are free text from the person, so both pass the same public filter before they show on the board.
  if (profile.nickname) {
    const nick = cleanNickname(profile.nickname);
    if (nick.ok) return nick.value;
  }
  const job = cleanNickname(shortJob(profile.jobTitle));
  return `${job.ok ? job.value : 'Member'} · ${digits}`;
}
