import { handleWebhook } from '@/server/billing';
import { HttpError, withApi } from '@/server/profile/http';

/**
 * POST /api/billing/webhook: signed Stripe subscription events. Off (404) unless STRIPE_WEBHOOK_SECRET is set;
 * then register customer.subscription.created/updated/deleted for {site}/api/billing/webhook in Stripe.
 */
export const POST = withApi(async (req: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(404, 'not_found', 'Webhook is not configured.');
  const raw = await req.text();
  return Response.json(await handleWebhook(raw, req.headers.get('stripe-signature'), secret));
});
