import { z } from 'zod';
import { createCheckout, siteOrigin } from '@/server/billing';
import { readOptionalJson } from '@/server/billing/body';
import { requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({ interval: z.enum(['month', 'year']).default('year') });

/**
 * POST /api/billing/checkout { interval: 'month' | 'year' (default year) } → { url } of a Stripe Checkout
 * page: subscription with a 7-day trial, the issued shop code applied (else promotion codes allowed).
 * 401, 409 already_subscribed, 502 payment_provider_error, 503 billing_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { interval } = await readOptionalJson(req, bodySchema);
  const { url } = await createCheckout(profile, interval, siteOrigin(req));
  return Response.json({ url });
});
