import { emit } from '@/server/events';
import { CUP_OFFER_ENDS_AT, CUP_OFFER_UNTIL, CUP_PRO_DAYS, cupOfferOpen } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { cupPlan, planActive } from './plan';

/**
 * Business Cup 2.0 offer (04.1.4): judges and guests open all of Pro with one request, no card and no
 * Stripe. `plan = { status: 'pro', source: 'cup', periodEnd: now + 30 days }`. Repeating the request
 * returns the same plan; a running Stripe subscription or trial gets 409 already_pro; after the offer
 * date, 410 offer_ended. Stripe Checkout keeps working next to it.
 */

export interface CupOffer {
  open: boolean;
  until: string;
  endsAt: string;
  days: number;
}

export const cupOffer = (now: Date = new Date()): CupOffer => ({ open: cupOfferOpen(now), until: CUP_OFFER_UNTIL, endsAt: CUP_OFFER_ENDS_AT, days: CUP_PRO_DAYS });

export async function unlockCup(profile: Profile, now: Date = new Date()): Promise<{ plan: Profile['plan']; created: boolean }> {
  if (profile.plan.source === 'cup') return { plan: profile.plan, created: false };
  if (!cupOfferOpen(now)) throw new HttpError(410, 'offer_ended', `The Business Cup 2.0 offer ended on ${CUP_OFFER_UNTIL}.`);
  const alreadyPro = () => new HttpError(409, 'already_pro', 'You already have Pro.', { plan: profile.plan });
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
