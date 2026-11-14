import Stripe from 'stripe';
import { isProReward, REWARDS, TIER_PRICES, type Tier } from '@/domain/points';
import { couponId, ensureCoupon } from '@/server/billing/codes';
import { STRIPE_PRODUCTS } from '@/server/billing/plan';
import { STRIPE_API_VERSION } from '@/server/billing/stripe';
import { loadEnv } from '../ai/load-env';

/**
 * npm run stripe:setup — prepares the Stripe TEST account, idempotently (safe to run again):
 *   - products «Irreplaceable Pro» (`irr_pro`) and «Irreplaceable Max» (`irr_coach`, the top tier, id 'coach');
 *   - prices by lookup_key: pro_monthly $19, pro_yearly $119, max_monthly $79, max_yearly $479
 *     (a changed amount gets a new price that takes the lookup_key over); the earlier top-tier prices
 *     (coach_monthly $39, coach_yearly $239) are archived;
 *   - one coupon per pro_* shop reward (`irr_<rewardId>`; free months only for the Pro product);
 *   - a Billing Portal configuration: cancel at period end, card update, invoices, and switching between
 *     the four prices (Pro ↔ Max, monthly ↔ yearly), `metadata.app`.
 * Refuses live keys. Prints ids only, never the key.
 */
loadEnv();

const PRODUCTS: Record<Tier, { name: string; description: string }> = {
  pro: { name: 'Irreplaceable Pro', description: 'Daily reps on your own work tasks, the 90-day plan, skills, all next jobs, proof and the Review kit.' },
  coach: { name: 'Irreplaceable Max', description: 'Everything in Pro plus a personal AI coach: chat and voice, knows your week, plan and skills.' },
};
/** Top-tier prices from before the Max rename: archived, never offered again. */
const RETIRED_LOOKUP_KEYS = ['coach_monthly', 'coach_yearly'];
const INTERVALS = ['month', 'year'] as const;

async function ensureProduct(stripe: Stripe, tier: Tier): Promise<Stripe.Product> {
  const id = STRIPE_PRODUCTS[tier];
  try {
    let product = await stripe.products.retrieve(id);
    if (!product.active || product.name !== PRODUCTS[tier].name || product.description !== PRODUCTS[tier].description) {
      product = await stripe.products.update(id, { active: true, name: PRODUCTS[tier].name, description: PRODUCTS[tier].description });
    }
    console.log(`product  ${product.id} (exists)`);
    return product;
  } catch (err) {
    if ((err as Stripe.errors.StripeError).code !== 'resource_missing') throw err;
    const product = await stripe.products.create({ id, ...PRODUCTS[tier], metadata: { app: 'irreplaceable', tier } });
    console.log(`product  ${product.id} (created)`);
    return product;
  }
}

async function ensurePrice(stripe: Stripe, tier: Tier, interval: (typeof INTERVALS)[number], productId: string): Promise<string> {
  const { usd, lookupKey } = TIER_PRICES[tier][interval];
  const amount = usd * 100;
  const found = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data[0];
  const ok = found && found.active && found.unit_amount === amount && found.currency === 'usd' && found.recurring?.interval === interval && found.product === productId;
  if (ok) {
    console.log(`price    ${lookupKey} ${found.id} $${usd}/${interval} (exists)`);
    return found.id;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: Boolean(found),
    nickname: `${PRODUCTS[tier].name.replace('Irreplaceable ', '')} ${interval === 'month' ? 'monthly' : 'yearly'}`,
    metadata: { app: 'irreplaceable', tier },
  });
  if (found?.active) await stripe.prices.update(found.id, { active: false });
  console.log(`price    ${lookupKey} ${price.id} $${usd}/${interval} (created)`);
  return price.id;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set (.env.local)');
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('stripe:setup runs against a test-mode key only');
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, maxNetworkRetries: 2 });

  const prices: Record<Tier, string[]> = { pro: [], coach: [] };
  for (const tier of ['pro', 'coach'] as const) {
    const product = await ensureProduct(stripe, tier);
    for (const interval of INTERVALS) prices[tier].push(await ensurePrice(stripe, tier, interval, product.id));
  }

  // Archive the retired top-tier prices (subscriptions already on them keep working and map to Max)
  for (const lookupKey of RETIRED_LOOKUP_KEYS) {
    const old = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })).data[0];
    if (old?.active) {
      await stripe.prices.update(old.id, { active: false });
      console.log(`price    ${lookupKey} ${old.id} (archived)`);
    } else if (old) {
      console.log(`price    ${lookupKey} ${old.id} (already archived)`);
    }
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
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: [
        { product: STRIPE_PRODUCTS.pro, prices: prices.pro },
        { product: STRIPE_PRODUCTS.coach, prices: prices.coach },
      ],
    },
    customer_update: { enabled: true, allowed_updates: ['email', 'name'] },
  };
  const business_profile = { headline: 'Irreplaceable Pro and Max (Stripe test mode)' };
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
