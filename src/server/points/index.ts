import { availableRewards, award, boardHandle, levelOf, nextReward, POINT_RULES, xpOf } from '@/domain/points';
import type { Profile } from '@/domain/types';
import type { Subscriber } from '@/server/events';
import { boardWeek, scheduleBoardSync, syncBoard, weekXpOf } from '@/server/leaderboard';

/**
 * Points subscriber for the product events bus (registered in `src/server/events.register.ts`).
 * All rules live in `award` (src/domain/points.ts); this adapter only hands the event over.
 * Runs inside `updateProfile`, so the journal, balance and XP are written in the same version as the
 * change that caused the event, and a retried write re-applies it to the fresh profile. The weekly
 * leaderboard is updated after the response, from the saved profile.
 */
export const pointsSubscriber: Subscriber = (profile, event) => {
  const res = award(profile, event);
  if (!res.awards.length) return undefined;
  scheduleBoardSync(profile.id);
  return res;
};

/** How many journal entries GET /api/points returns (newest first). */
export const EVENTS_SHOWN = 50;

/** XP, level and this week's XP of a profile (header, Home, public portfolio). */
export function progressOf(profile: Profile, now: Date = new Date()) {
  const { xp, level, levelName, label, levelAt, nextAt } = levelOf(xpOf(profile));
  return { xp, level, levelName, levelLabel: label, levelAt, nextAt, weekXp: weekXpOf(profile, boardWeek(now)), handle: boardHandle(profile) };
}

/** GET /api/points: balance, XP and level, latest journal entries, the earning rules and the nearest reward. */
export async function pointsView(profile: Profile, now: Date = new Date()) {
  const events = [...profile.points.events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, EVENTS_SHOWN);
  // keep the reader's own board entry current (cheap, idempotent); a board outage never fails the points
  await syncBoard(profile, now).catch((err: Error) => console.error(`[leaderboard] sync failed: ${err.message}`));
  return {
    balance: profile.points.balance,
    ...progressOf(profile, now),
    events,
    rules: POINT_RULES,
    nextReward: nextReward(profile.points.balance),
    available: availableRewards(profile),
    freezes: profile.streak.freezes,
  };
}
