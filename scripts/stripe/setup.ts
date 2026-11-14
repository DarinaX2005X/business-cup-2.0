import Stripe from 'stripe';
import { isProReward, PRO_PRICES, REWARDS, type ProInterval } from '@/domain/points';
import { couponId, ensureCoupon } from '@/server/billing/codes';
import { STRIPE_API_VERSION } from '@/server/billing/stripe';
import { loadEnv } from '../ai/load-env';

/**
 * npm run stripe:setup — prepares the Stripe TEST account, idempotently (safe to run again):
 *   - product «Irreplaceable Pro» (fixed id `irr_pro`);
 *   - prices by lookup_key: pro_monthly $19/month, pro_yearly $119/year (a changed amount gets a new
 *     price that takes the lookup_key over);
 *   - one coupon per pro_* shop reward (`irr_<rewardId>`, metadata.reward_id);
 *   - a Billing Portal configuration (cancel at period end, card update, invoices), `metadata.app`.
 * Refuses live keys. Prints ids only, never the key.
 */
loadEnv();

const PRODUCT_ID = 'irr_pro';
const AMOUNTS: Record<ProInterval, number> = { month: PRO_PRICES.month.usd * 100, year: PRO_PRICES.year.usd * 100 };

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set (.env.local)');
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('stripe:setup runs against a test-mode key only');
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, maxNetworkRetries: 2 });

  // Product
  let product: Stripe.Product;
  try {
    product = await stripe.products.retrieve(PRODUCT_ID);
    if (!product.active) product = await stripe.products.update(PRODUCT_ID, { active: true });
    console.log(`product  ${product.id} (exists)`);
  } catch (err) {
    if ((err as Stripe.errors.StripeError).code !== 'resource_missing') throw err;
    product = await stripe.products.create({
      id: PRODUCT_ID,
      name: 'Irreplaceable Pro',
      description: 'Daily reps on your own work tasks, the 90-day plan, all neighbouring jobs, proof and the review kit.',
      metadata: { app: 'irreplaceable' },
    });
    console.log(`product  ${product.id} (created)`);
  }

  // Prices
  for (const interval of ['month', 'year'] as const) {
    const lookupKey = PRO_PRICES[interval].lookupKey;
    const found = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data[0];
    const ok = found && found.active && found.unit_amount === AMOUNTS[interval] && found.currency === 'usd' && found.recurring?.interval === interval && found.product === product.id;
    if (ok) {
      console.log(`price    ${lookupKey} ${found.id} $${AMOUNTS[interval] / 100}/${interval} (exists)`);
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: AMOUNTS[interval],
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: Boolean(found),
      nickname: `Pro ${interval === 'month' ? 'monthly' : 'yearly'}`,
      metadata: { app: 'irreplaceable' },
    });
    if (found?.active) await stripe.prices.update(found.id, { active: false });
    console.log(`price    ${lookupKey} ${price.id} $${AMOUNTS[interval] / 100}/${interval} (created)`);
  }

  // Coupons for the shop's Pro rewards
  for (const reward of REWARDS.filter(isProReward)) {
    const id = await ensureCoupon(stripe, reward);
    console.log(`coupon   ${id}${id === couponId(reward.id) ? '' : ' (unexpected id)'}`);
  }

  // Billing Portal
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',
      cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'switched_service', 'other'] },
    },
    customer_update: { enabled: true, allowed_updates: ['email', 'name'] },
  };
  const business_profile = { headline: 'Irreplaceable Pro (Stripe test mode)' };
  const configs = await stripe.billingPortal.configurations.list({ limit: 20 });
  const ours = configs.data.find((c) => c.metadata?.app === 'irreplaceable');
  const config = ours
    ? await stripe.billingPortal.configurations.update(ours.id, { active: true, features, business_profile })
    : await stripe.billingPortal.configurations.create({ features, business_profile, metadata: { app: 'irreplaceable' } });
  console.log(`portal   ${config.id} ${ours ? '(updated)' : '(created)'} default=${config.is_default}`);
  console.log('Stripe test account is ready.');
}

main().catch((err) => {
  console.error(`stripe:setup failed: ${(err as Error).message}`);
  process.exit(1);
});
