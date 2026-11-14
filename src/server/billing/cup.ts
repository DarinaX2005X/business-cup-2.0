import { emit } from '@/server/events';
import { CUP_OFFER_ENDS_AT, CUP_OFFER_UNTIL, cupOfferOpen, tierName } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { cupPlan, planActive } from './plan';

/**
 * Business Cup 2.0 offer (04.1.4, round 3): judges and guests open everything, the Max tier included,
 * with one request, no card and no Stripe: `plan = { status: 'pro', source: 'cup', tier: 'coach',
 * periodEnd: end of November 30 }`. Repeating the request returns the same plan (an older Cup plan is
 * moved to Max); a running Stripe subscription or trial gets 409 already_pro; after the offer date,
 * 410 offer_ended. Stripe Checkout keeps working next to it.
 */

export interface CupOffer {
  open: boolean;
  /** last day of the offer and of the Max plan it gives, '2026-11-30' */
  until: string;
  endsAt: string;
  /** internal tier id of the plan it gives */
  tier: 'coach';
  /** display name of that tier: 'Max' */
  tierName: string;
  /** one line for the offer, e.g. «Business Cup 2.0: Max is free until November 30, 2026.» */
  headline: string;
  /** whole days left until the plan ends (for "N days of Max left") */
  days: number;
}

export const cupOffer = (now: Date = new Date()): CupOffer => ({
  open: cupOfferOpen(now),
  until: CUP_OFFER_UNTIL,
  endsAt: CUP_OFFER_ENDS_AT,
  tier: 'coach',
  tierName: tierName('coach'),
  headline: `Business Cup 2.0: ${tierName('coach')} is free until November 30, 2026.`,
  days: Math.max(0, Math.ceil((Date.parse(CUP_OFFER_ENDS_AT) - now.getTime()) / 86_400_000)),
});

export async function unlockCup(profile: Profile, now: Date = new Date()): Promise<{ plan: Profile['plan']; created: boolean }> {
  if (profile.plan.source === 'cup') {
    if (profile.plan.tier === 'coach') return { plan: profile.plan, created: false };
    // a Cup plan from before round 3 (Pro): it is Max now, same end date
    const { profile: saved } = await updateProfile(
      profile.id,
      (p) => {
        if (p.plan.source === 'cup') p.plan = { ...p.plan, tier: 'coach' };
      },
      { current: profile },
    );
    return { plan: saved.plan, created: false };
  }
  if (!cupOfferOpen(now)) throw new HttpError(410, 'offer_ended', `The Business Cup 2.0 offer (free ${tierName('coach')}) ended on ${CUP_OFFER_UNTIL}.`);
  const alreadyPro = () => new HttpError(409, 'already_pro', 'You already have a paid plan.', { plan: profile.plan });
  if (planActive(profile.plan, now)) throw alreadyPro();
  let created = false;
  const { profile: saved } = await updateProfile(
    profile.id,
    (p) => {
      created = false;
      if (p.plan.source === 'cup') return; // a parallel request unlocked it first
      if (planActive(p.plan, now)) throw alreadyPro();
      p.plan = cupPlan(p.plan, now);
      created = true;
      return emit(p, { type: 'cup_unlocked', ref: 'cup' });
    },
    { current: profile },
  );
  return { plan: saved.plan, created };
}
