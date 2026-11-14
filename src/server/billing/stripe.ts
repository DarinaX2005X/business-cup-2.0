import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { HttpError } from '@/server/profile/http';

/**
 * Stripe client for the whole app (test mode only: the product has no business account, PLAN «Оплата»).
 *
 * API version: pinned to the account's default at setup time, 2026-08-26.dahlia (read from the
 * `Stripe-Version` header of an unversioned request). The installed SDK (23.1) types the next version,
 * 2026-10-28.endive. Its changelog lists no change between the two for the calls made here: coupons
 * (`id`, `percent_off`, `duration`, `duration_in_months`), promotion codes (`promotion: { type: 'coupon',
 * coupon }`, `code`, `max_redemptions`), Checkout `discounts` / `allow_promotion_codes` /
 * `payment_method_collection` / `subscription_data.trial_period_days`, subscription `discounts` on
 * update, item `current_period_end`, Billing Portal sessions and configurations. Webhook payloads are
 * rendered in the account version, so pinning it keeps them and our responses in one shape.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/** The calls the billing code makes; tests replace it with a stub. */
export type BillingStripe = Pick<Stripe, 'coupons' | 'promotionCodes' | 'subscriptions' | 'customers' | 'prices' | 'products' | 'checkout' | 'billingPortal' | 'webhooks'>;

let client: BillingStripe | null = null;
let override: BillingStripe | null = null;

export function setStripeForTests(stub: BillingStripe | null): void {
  override = stub;
}

const isTestKey = (key: string) => /^(sk|rk)_test_/.test(key);

/** The client, or 503 billing_unavailable when no test key is configured. Live keys are refused. */
export function getStripe(): BillingStripe {
  if (override) return override;
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new HttpError(503, 'billing_unavailable', 'Payments are not configured (STRIPE_SECRET_KEY is missing).');
  if (!isTestKey(key)) {
    console.error('[billing] STRIPE_SECRET_KEY is not a test-mode key; payments stay off');
    throw new HttpError(503, 'billing_unavailable', 'Payments run in Stripe test mode only.');
  }
  client = new Stripe(key, {
    // The account version differs from the SDK's typed one; see the note above.
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    maxNetworkRetries: 2,
    timeout: 20_000,
    typescript: true,
    appInfo: { name: 'Irreplaceable' },
  });
  return client;
}

/** A Stripe API error (as opposed to our own HttpError or a programming error). */
export function isStripeError(err: unknown): err is Stripe.errors.StripeError {
  return err instanceof Stripe.errors.StripeError || (typeof err === 'object' && err !== null && typeof (err as { type?: unknown }).type === 'string' && (err as { type: string }).type.startsWith('Stripe'));
}

export const stripeCode = (err: unknown): string | undefined => (isStripeError(err) ? err.code : undefined);

/**
 * Runs one Stripe call. A Stripe failure becomes 502 `payment_provider_error` with a reference id;
 * the details stay in the server log (never the key, never the raw payload).
 */
export async function stripeCall<T>(op: string, fn: (s: BillingStripe) => Promise<T>): Promise<T> {
  const s = getStripe();
  try {
    return await fn(s);
  } catch (err) {
    if (!isStripeError(err)) throw err;
    const ref = randomBytes(4).toString('hex');
    console.error(`[billing] ref=${ref} ${op} failed: ${err.type} ${err.code ?? ''} ${err.statusCode ?? ''} ${err.requestId ?? ''} ${err.message}`);
    throw new HttpError(502, 'payment_provider_error', `Stripe did not complete ${op} (ref ${ref}). Nothing was charged or spent.`);
  }
}
