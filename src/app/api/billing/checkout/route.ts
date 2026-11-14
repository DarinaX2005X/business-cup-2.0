import { z } from 'zod';
import { createCheckout, siteOrigin } from '@/server/billing';
import { readOptionalJson } from '@/server/billing/body';
import { requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({
  // 'max' is the display name of the top tier; its id is 'coach'
  tier: z
    .enum(['pro', 'coach', 'max'])
    .default('pro')
    .transform((t) => (t === 'max' ? 'coach' : t)),
  interval: z.enum(['month', 'year']).default('year'),
});

/**
 * POST /api/billing/checkout { tier: 'pro' | 'coach' (Max; 'max' accepted) (default pro), interval: 'month' | 'year' (default year) }
 * → { url } of a Stripe Checkout page: subscription with a 7-day trial on a first subscription, the issued
 * shop code applied (else promotion codes allowed). 401, 409 already_subscribed { tier } (use the portal to
 * switch tiers), 502 payment_provider_error, 503 billing_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { tier, interval } = await readOptionalJson(req, bodySchema);
  const { url } = await createCheckout(profile, { tier, interval }, siteOrigin(req));
  return Response.json({ url });
});
