import { cupOffer, unlockCup } from '@/server/billing';
import { isPro } from '@/server/profile';
import { requireProfile, withApi } from '@/server/profile/http';

/** GET /api/billing/cup → { open, until, endsAt, days }: the Business Cup 2.0 offer (no profile needed). */
export const GET = withApi(async () => Response.json(cupOffer(), { headers: { 'Cache-Control': 'no-store' } }));

/**
 * POST /api/billing/cup → 201 { plan, isPro, offer } (200 with the same plan when already unlocked).
 * Pro for 30 days with no payment. 401, 409 already_pro (Stripe subscription or trial), 410 offer_ended.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { plan, created } = await unlockCup(profile);
  return Response.json({ plan, isPro: isPro({ plan }), offer: cupOffer() }, { status: created ? 201 : 200 });
});
