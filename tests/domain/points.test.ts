import { describe, expect, it } from 'vitest';
import {
  XRAY_AWARDS_MAX,
  applyFreeze,
  availableRewards,
  award,
  nextReward,
  POINT_RULES,
  redeemBlock,
  rewardById,
  spend,
  STREAK_MARKS,
  type PointsTrigger,
} from '@/domain/points';
import { applyStreak, streakAsOf } from '@/domain/reps';
import type { Profile } from '@/domain/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    version: 1,
    secretHash: 'x'.repeat(64),
    createdAt: '2026-11-14T10:00:00Z',
    locale: 'en',
    tz: 'America/Chicago',
    xrays: [],
    reps: [],
    repLog: [],
    trial: { status: 'available' },
    streak: { current: 0, best: 0, lastDay: null, days: [], freezes: 0 },
    points: { balance: 0, events: [] },
    redemptions: [],
    plan: { status: 'free' },
    proof: [],
    sound: true,
    hintsSeen: [],
    ...over,
  };
}

const ev = (type: string, ref: string, at: string, data?: Record<string, unknown>): PointsTrigger => ({ type, ref, at, data });

/** Runs events in order like the bus does, returning the final profile and every award. */
function run(p: Profile, events: PointsTrigger[]) {
  let cur = p;
  const awards: { type: string; points: number }[] = [];
  for (const e of events) {
    const r = award(cur, e);
    cur = r.profile;
    awards.push(...r.awards);
  }
  return { profile: cur, awards, total: awards.reduce((n, a) => n + a.points, 0) };
}

/** A completed rep the way the engine records it before emitting rep_completed. */
function withRep(p: Profile, id: string, kind: 'daily' | 'extra' | 'trial', day: string, score: number): Profile {
  const streak = kind === 'extra' ? p.streak : applyStreak(p.streak, day);
  return { ...p, streak, repLog: [...p.repLog, { id, taskId: 't1', type: 'slip', kind, day, score }] };
}

describe('earning rules', () => {
  it('the rules table lists every earning type with its points range and limit', () => {
    const types = new Set(POINT_RULES.map((r) => r.type));
    for (const t of ['xray_completed', 'week_confirmed', 'rep_completed', 'rep_perfect', 'first_rep', 'streak_bonus', 'ai_or_me', 'used_at_work', 'proof_shared', 'review_kit', 'invite_completed', 'invited_bonus', 'pivot_explored']) {
      expect(types.has(t as never)).toBe(true);
    }
    expect(POINT_RULES.find((r) => r.id === 'rep_daily')).toMatchObject({ min: 20, max: 60 });
    expect(POINT_RULES.find((r) => r.id === 'rep_extra')).toMatchObject({ min: 10, max: 30, limit: { kind: 'per_day', count: 3 } });
    expect(POINT_RULES.find((r) => r.id === 'ai_or_me')).toMatchObject({ min: 10, max: 35 });
  });

  it('a fresh profile earns enough in the first session for the first reward (250)', () => {
    // map 100 + week 20 + first rep 50 + trial rep (score 0.75 → 50) + AI or me 4 of 5 (30) = 250
    let p = profile();
    let r = run(p, [ev('xray_completed', '29-1141.00', '2026-11-14T15:00:00Z'), ev('week_confirmed', '2026-W46', '2026-11-14T15:00:00Z')]);
    p = withRep(r.profile, 'trial1', 'trial', '2026-11-14', 0.75);
    r = run(p, [ev('rep_completed', 'trial1', '2026-11-14T15:10:00Z', { score: 0.75, type: 'slip', kind: 'trial' }), ev('ai_or_me', '2026-11-14-abc', '2026-11-14T15:15:00Z', { correct: 4, total: 5 })]);
    expect(r.profile.points.balance).toBe(250);
    expect(redeemBlock(r.profile, rewardById('pro_10')!)).toBeNull();
    expect(availableRewards(r.profile)).toContain('pro_10');

    // a weaker session (half the slip, 3 of 5) is 235, and one "I used this at work" closes the gap
    let q = run(profile(), [ev('xray_completed', '29-1141.00', '2026-11-14T15:00:00Z'), ev('week_confirmed', '2026-W46', '2026-11-14T15:00:00Z')]).profile;
    q = withRep(q, 'trial1', 'trial', '2026-11-14', 0.5);
    q = run(q, [ev('rep_completed', 'trial1', '2026-11-14T15:10:00Z', { score: 0.5, kind: 'trial' }), ev('ai_or_me', '2026-11-14-abc', '2026-11-14T15:15:00Z', { correct: 3 })]).profile;
    expect(q.points.balance).toBe(235);
    expect(nextReward(q.points.balance)).toEqual({ rewardId: 'pro_10', cost: 250, need: 15 });
    q = run(q, [ev('used_at_work', '2026-11-14:w1', '2026-11-14T15:20:00Z', { minutes: 30 })]).profile;
    expect(q.points.balance).toBe(250);
  });

  it('every award is idempotent by type and ref', () => {
    const p = withRep(profile(), 'r1', 'daily', '2026-11-14', 1);
    const e = ev('rep_completed', 'r1', '2026-11-14T15:00:00Z', { score: 1, kind: 'daily' });
    const first = award(p, e);
    expect(first.awards.map((a) => [a.type, a.points])).toEqual([
      ['rep_completed', 60],
      ['rep_perfect', 20],
      ['first_rep', 50],
    ]);
    const again = award(first.profile, e);
    expect(again.awards).toEqual([]);
    expect(again.profile).toBe(first.profile);
    expect(award(first.profile, ev('xray_completed', 'A', '2026-11-14T15:00:00Z')).awards).toHaveLength(1);
    const twice = run(first.profile, [ev('xray_completed', 'A', '2026-11-14T15:00:00Z'), ev('xray_completed', 'A', '2026-11-15T15:00:00Z')]);
    expect(twice.total).toBe(100);
  });

  it('map awards stop after XRAY_AWARDS_MAX occupations, so mapping many jobs cannot mint points', () => {
    const codes = ['11-1011.00', '13-2011.00', '15-1252.00', '29-1141.00', '47-2111.00'];
    const r = run(profile(), codes.map((c) => ev('xray_completed', c, '2026-11-14T15:00:00Z')));
    expect(r.awards.filter((a) => a.type === 'xray_completed')).toHaveLength(XRAY_AWARDS_MAX);
    expect(r.total).toBe(100 * XRAY_AWARDS_MAX);
  });

  it('daily limits: extras 3 a day, AI or me once a day, work log 3 a day; a new day starts over', () => {
    let p = withRep(profile(), 'd1', 'daily', '2026-11-14', 0.5);
    p = run(p, [ev('rep_completed', 'd1', '2026-11-14T15:00:00Z', { score: 0.5, kind: 'daily' })]).profile;
    const before = p.points.balance;
    for (const id of ['x1', 'x2', 'x3', 'x4']) {
      p = withRep(p, id, 'extra', '2026-11-14', 1);
      p = run(p, [ev('rep_completed', id, '2026-11-14T16:00:00Z', { score: 1, kind: 'extra' })]).profile;
    }
    expect(p.points.balance - before).toBe(3 * (30 + 20)); // the fourth extra earns nothing

    const ai = run(p, [
      ev('ai_or_me', '2026-11-14-a', '2026-11-14T17:00:00Z', { correct: 5 }),
      ev('ai_or_me', '2026-11-14-b', '2026-11-14T17:05:00Z', { correct: 5 }),
      ev('ai_or_me', '2026-11-15-c', '2026-11-15T17:00:00Z', { correct: 2 }),
    ]);
    expect(ai.awards.map((a) => a.points)).toEqual([35, 20]);

    const work = run(p, ['a', 'b', 'c', 'd'].map((id) => ev('used_at_work', `2026-11-14:${id}`, '2026-11-14T18:00:00Z')));
    expect(work.total).toBe(45);
    expect(run(work.profile, [ev('used_at_work', '2026-11-15:e', '2026-11-15T18:00:00Z')]).total).toBe(15);
  });

  it('week once per ISO week, proof once per 7 days, review kit once per 30 days, pivot once, invites up to 10', () => {
    const r = run(profile(), [
      ev('week_confirmed', '2026-W46', '2026-11-14T15:00:00Z'),
      ev('week_confirmed', '2026-W46', '2026-11-15T15:00:00Z'),
      ev('week_confirmed', '2026-W47', '2026-11-17T15:00:00Z'),
      ev('proof_shared', 'pf1', '2026-11-14T15:00:00Z'),
      ev('proof_shared', 'pf2', '2026-11-20T15:00:00Z'),
      ev('proof_shared', 'pf3', '2026-11-21T15:00:00Z'),
      ev('review_kit', 'k1', '2026-11-14T15:00:00Z'),
      ev('review_kit', 'k2', '2026-12-01T15:00:00Z'),
      ev('review_kit', 'k3', '2026-12-14T15:00:00Z'),
      ev('pivot_explored', '15-1252.00', '2026-11-14T15:00:00Z'),
      ev('pivot_explored', '13-2011.00', '2026-11-15T15:00:00Z'),
      ...Array.from({ length: 12 }, (_, i) => ev('invite_completed', `friend${i}`, '2026-11-14T15:00:00Z')),
    ]);
    const sum = (type: string) => r.awards.filter((a) => a.type === type).reduce((n, a) => n + a.points, 0);
    expect(sum('week_confirmed')).toBe(40);
    expect(sum('proof_shared')).toBe(50);
    expect(sum('review_kit')).toBe(100);
    expect(sum('pivot_explored')).toBe(15);
    expect(sum('invite_completed')).toBe(3000);
  });

  it('the invited colleague gets 100 once with their first map', () => {
    const r = run(profile({ invitedBy: 'inviter' }), [ev('xray_completed', 'A', '2026-11-14T15:00:00Z'), ev('xray_completed', 'B', '2026-11-15T15:00:00Z')]);
    expect(r.awards.map((a) => [a.type, a.points])).toEqual([
      ['xray_completed', 100],
      ['invited_bonus', 100],
      ['xray_completed', 100],
    ]);
  });

  it('streak bonuses pay once at 3 and 7 days, again only in a new series', () => {
    let p = profile();
    const days = Array.from({ length: 8 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);
    const bonuses: number[] = [];
    for (const [i, day] of days.entries()) {
      p = withRep(p, `d${i}`, 'daily', day, 0.5);
      const r = award(p, ev('rep_completed', `d${i}`, `${day}T15:00:00Z`, { score: 0.5, kind: 'daily' }));
      p = r.profile;
      bonuses.push(...r.awards.filter((a) => a.type === 'streak_bonus').map((a) => a.points));
      // an extra the same day does not pay the mark again
      p = withRep(p, `x${i}`, 'extra', day, 0.5);
      p = award(p, ev('rep_completed', `x${i}`, `${day}T16:00:00Z`, { score: 0.5, kind: 'extra' })).profile;
    }
    expect(bonuses).toEqual([STREAK_MARKS[0].points, STREAK_MARKS[1].points]);
    expect(p.points.events.find((e) => e.type === 'streak_bonus')?.ref).toBe('3:2026-11-12');
    // break, then a new 3-day series pays the 3-day mark again
    for (const day of ['2026-11-20', '2026-11-21', '2026-11-22']) {
      p = withRep(p, `n${day}`, 'daily', day, 0.5);
      const r = award(p, ev('rep_completed', `n${day}`, `${day}T15:00:00Z`, { score: 0.5, kind: 'daily' }));
      p = r.profile;
      bonuses.push(...r.awards.filter((a) => a.type === 'streak_bonus').map((a) => a.points));
    }
    expect(bonuses).toEqual([50, 150, 50]);
  });

  it('ignores malformed event data instead of paying for it', () => {
    const p = withRep(profile(), 'r1', 'daily', '2026-11-14', 1);
    expect(award(p, ev('rep_completed', 'r1', '2026-11-14T15:00:00Z', { score: 'high', kind: 'daily' })).awards).toEqual([]);
    expect(award(p, ev('rep_completed', 'r1', '2026-11-14T15:00:00Z', { score: 1, kind: 'weekly' })).awards).toEqual([]);
    expect(award(p, ev('ai_or_me', '2026-11-14-a', '2026-11-14T15:00:00Z')).awards).toEqual([]);
    expect(award(p, ev('cup_unlocked', 'cup', '2026-11-14T15:00:00Z')).awards).toEqual([]);
    // score above 1 is clamped
    expect(award(p, ev('rep_completed', 'r1', '2026-11-14T15:00:00Z', { score: 7, kind: 'daily' })).awards[0].points).toBe(60);
  });

  it('keeps lifetime events and trims old windowed ones', () => {
    let p = run(profile(), [ev('xray_completed', 'A', '2026-09-01T15:00:00Z'), ev('used_at_work', '2026-09-01:a', '2026-09-01T15:00:00Z')]).profile;
    p = run(p, [ev('used_at_work', '2026-11-14:b', '2026-11-14T15:00:00Z')]).profile;
    expect(p.points.events.map((e) => e.ref)).toEqual(['A', '2026-11-14:b']);
    expect(p.points.balance).toBe(130);
  });
});

describe('spending', () => {
  it('never takes the balance below zero and is idempotent per redemption', () => {
    const p = profile({ points: { balance: 300, events: [] } });
    const a = spend(p, 250, 'rd1', '2026-11-14T15:00:00Z')!;
    expect(a.points.balance).toBe(50);
    expect(a.points.events.at(-1)).toMatchObject({ type: 'redeem', points: -250, ref: 'rd1' });
    expect(spend(a, 250, 'rd1', '2026-11-14T15:00:00Z')).toBe(a);
    expect(spend(a, 250, 'rd2', '2026-11-14T15:00:00Z')).toBeNull();
  });

  it('nextReward points at the cheapest reward not yet reached', () => {
    expect(nextReward(0)).toEqual({ rewardId: 'pro_10', cost: 250, need: 250 });
    expect(nextReward(760)).toEqual({ rewardId: 'pro_25', cost: 2000, need: 1240 });
    expect(nextReward(60_000)).toBeNull();
  });

  it('redeem blocks: one issued Pro code at a time, two freezes at most, coming soon has no price', () => {
    const rich = profile({ points: { balance: 10_000, events: [] } });
    const withCode = { ...rich, redemptions: [{ id: 'rd1', rewardId: 'pro_10', cost: 250, status: 'issued' as const, at: '' }] };
    expect(redeemBlock(withCode, rewardById('pro_25')!)).toBe('discount_pending');
    expect(redeemBlock(withCode, rewardById('streak_freeze')!)).toBeNull();
    expect(redeemBlock({ ...rich, streak: { ...rich.streak, freezes: 2 } }, rewardById('streak_freeze')!)).toBe('freeze_limit');
    expect(redeemBlock(rich, rewardById('coming_soon_1')!)).toBe('not_available');
    expect(redeemBlock(profile(), rewardById('pro_10')!)).toBe('not_enough_points');
  });
});

describe('streak freeze', () => {
  const streak = (over: Partial<Profile['streak']>): Profile['streak'] => ({ current: 5, best: 5, lastDay: '2026-11-14', days: ['2026-11-14'], freezes: 0, ...over });

  it('covers missed days one freeze each, so the series continues', () => {
    const { streak: s, frozen } = applyFreeze(streak({ freezes: 2 }), '2026-11-16');
    expect(frozen).toEqual(['2026-11-15']);
    expect(s).toMatchObject({ freezes: 1, lastDay: '2026-11-15', current: 5 });
    expect(applyStreak(s, '2026-11-16')).toMatchObject({ current: 6, lastDay: '2026-11-16' });
    expect(streakAsOf(s, '2026-11-16').current).toBe(5);
  });

  it('does nothing when no day was missed or when the freezes do not cover the gap', () => {
    expect(applyFreeze(streak({ freezes: 2 }), '2026-11-15').frozen).toEqual([]);
    const far = applyFreeze(streak({ freezes: 1 }), '2026-11-17'); // two missed days, one freeze
    expect(far.frozen).toEqual([]);
    expect(far.streak.freezes).toBe(1);
    expect(applyStreak(far.streak, '2026-11-17').current).toBe(1);
    expect(applyFreeze(streak({ freezes: 2 }), '2026-11-17')).toMatchObject({ frozen: ['2026-11-15', '2026-11-16'], streak: { freezes: 0 } });
  });
});
