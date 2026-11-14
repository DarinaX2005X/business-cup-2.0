import { availableRewards, award, nextReward, POINT_RULES } from '@/domain/points';
import type { Profile } from '@/domain/types';
import type { Subscriber } from '@/server/events';

/**
 * Points subscriber for the product events bus (registered in `src/server/events.register.ts`).
 * All rules live in `award` (src/domain/points.ts); this adapter only hands the event over.
 * Runs inside `updateProfile`, so the journal and balance are written in the same version as the
 * change that caused the event, and a retried write re-applies it to the fresh profile.
 */
export const pointsSubscriber: Subscriber = (profile, event) => {
  const res = award(profile, event);
  return res.awards.length ? res : undefined;
};

/** How many journal entries GET /api/points returns (newest first). */
export const EVENTS_SHOWN = 50;

/** GET /api/points: balance, latest journal entries, the earning rules and the nearest reward. */
export function pointsView(profile: Profile) {
  const events = [...profile.points.events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, EVENTS_SHOWN);
  return {
    balance: profile.points.balance,
    events,
    rules: POINT_RULES,
    nextReward: nextReward(profile.points.balance),
    available: availableRewards(profile),
    freezes: profile.streak.freezes,
  };
}
