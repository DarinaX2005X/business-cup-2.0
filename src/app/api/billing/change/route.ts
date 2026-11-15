import { z } from 'zod';
import { createPlanChange, siteOrigin } from '@/server/billing';
import { readOptionalJson, requireAccount } from '@/server/billing/body';
import { requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({
  // 'max' is the display name of the top tier; its id is 'coach'
  tier: z.enum(['pro', 'coach', 'max']).transform((t) => (t === 'max' ? 'coach' : t)),
});

/**
 * POST /api/billing/change { tier: 'pro' | 'coach' ('max' accepted) } → { url } of the Stripe Billing Portal's
 * confirm page for switching the running subscription. Upgrading to Max charges only the difference now;
 * switching to Pro takes effect at renewal. Account required. 401, 409 demo_account / no_subscription /
 * same_plan, 502 payment_provider_error, 503 billing_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  requireAccount(profile);
  const { tier } = await readOptionalJson(req, bodySchema);
  return Response.json(await createPlanChange(profile, tier, siteOrigin(req)));
});
