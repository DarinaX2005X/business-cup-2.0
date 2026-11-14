import { confirmCheckout } from '@/server/billing';
import { HttpError, requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/billing/confirm?session_id=cs_test_… → { plan } after a finished Checkout of this profile
 * (plan trialing/pro with periodEnd; the shop code used in it becomes applied). Repeatable.
 * 400, 401, 404 not_found, 409 checkout_open.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const sessionId = new URL(req.url).searchParams.get('session_id');
  if (!sessionId) throw new HttpError(400, 'invalid_input', 'session_id is required');
  return Response.json(await confirmCheckout(profile, sessionId), { headers: { 'Cache-Control': 'no-store' } });
});
