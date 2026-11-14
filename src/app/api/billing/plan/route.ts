import { ensureFreshPlan } from '@/server/billing';
import { isPro } from '@/server/profile';
import { requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/billing/plan[?sync=1] → { plan, isPro }. An expired Stripe plan is read from Stripe again;
 * `sync=1` (after returning from the Billing Portal) reads it now. 401.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const force = new URL(req.url).searchParams.get('sync') === '1';
  const fresh = await ensureFreshPlan(profile, { force });
  return Response.json({ plan: fresh.plan, isPro: isPro(fresh) }, { headers: { 'Cache-Control': 'no-store' } });
});
