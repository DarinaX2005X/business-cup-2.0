import { cupOffer, unlockCup } from '@/server/billing';
import { requireAccount } from '@/server/billing/body';
import { isPro } from '@/server/profile';
import { requireProfile, withApi } from '@/server/profile/http';

/** GET /api/billing/cup → { open, until, endsAt, tier, tierName, headline, days }: the Business Cup 2.0 offer (no profile needed). */
export const GET = withApi(async () => Response.json(cupOffer(), { headers: { 'Cache-Control': 'no-store' } }));

/**
 * POST /api/billing/cup (account required) → 201 { plan, isPro, offer } (200 with the same plan when already
 * unlocked). Max until the end of Nov 30, no payment. 401 unauthorized / account_required,
 * 409 already_pro (Stripe subscription or trial), 410 offer_ended.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  requireAccount(profile, { allowDemo: true });
  const { plan, created } = await unlockCup(profile);
  return Response.json({ plan, isPro: isPro({ plan }), offer: cupOffer() }, { status: created ? 201 : 200 });
});
