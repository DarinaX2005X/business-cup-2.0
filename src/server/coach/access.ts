import type { Profile } from '@/domain/types';
import { isCoach, isPro } from '@/server/profile';

/**
 * Who may talk to the coach: `isCoach` from the billing package (an active Coach-tier plan; the Business
 * Cup offer counts as Coach; DEV_FORCE_COACH=1 outside production). Free and Pro see the locked preview.
 */

export type CoachTier = 'free' | 'pro' | 'coach';

export function tierOf(profile: Pick<Profile, 'plan'>, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): CoachTier {
  if (isCoach(profile, now, env)) return 'coach';
  return isPro(profile, now, env) ? 'pro' : 'free';
}

export const hasCoach = (profile: Pick<Profile, 'plan'>, now?: Date, env?: NodeJS.ProcessEnv) => isCoach(profile, now, env);
