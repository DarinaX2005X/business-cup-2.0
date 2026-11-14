import Stripe from 'stripe';
import type { BillingStripe } from '@/server/billing';

/**
 * In-memory Stripe for unit tests: the calls the billing code makes, with Stripe-shaped errors.
 * `calls` records every request; `failNext[op]` makes the next call of that op throw an API error.
 */

const err = (code: string, message = code) => new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code, message });

export interface StubSub {
  id: string;
  status: Stripe.Subscription.Status;
  customer: string;
  trial_end: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  ended_at: number | null;
  discounts: string[];
  metadata: Record<string, string>;
  items: { data: { current_period_end: number; price: { lookup_key?: string | null; product?: string; recurring: { interval: 'month' | 'year' } } }[] };
}

export function createStripeStub() {
  let n = 0;
  const id = (p: string) => `${p}_${++n}`;
  const calls: { op: string; args: unknown[] }[] = [];
  const failNext: Record<string, string | undefined> = {};
  const coupons = new Map<string, Record<string, unknown>>();
  const promos = new Map<string, { id: string; code: string; active: boolean; max_redemptions: number; metadata: Record<string, string>; coupon: string }>();
  const subs = new Map<string, StubSub>();
  const customers = new Map<string, { id: string; metadata: Record<string, string> }>();
  const idem = new Map<string, unknown>();
  const sessions = new Map<string, Record<string, unknown>>();

  const op = async <T>(name: string, args: unknown[], fn: () => T): Promise<T> => {
    calls.push({ op: name, args });
    const f = failNext[name];
    if (f) {
      failNext[name] = undefined;
      throw err(f, `stub failure: ${f}`);
    }
    return fn();
  };

  const webhooks = new Stripe('sk_test_stub', { apiVersion: '2026-10-28.endive' }).webhooks;

  const stub = {
    coupons: {
      retrieve: (cid: string) =>
        op('coupons.retrieve', [cid], () => {
          const c = coupons.get(cid);
          if (!c) throw err('resource_missing');
          return c;
        }),
      create: (params: Record<string, unknown>) =>
        op('coupons.create', [params], () => {
          const cid = params.id as string;
          if (coupons.has(cid)) throw err('resource_already_exists');
          const c = { ...params, valid: true };
          coupons.set(cid, c);
          return c;
        }),
    },
    promotionCodes: {
      create: (params: { promotion: { coupon: string }; code: string; max_redemptions: number; metadata: Record<string, string> }) =>
        op('promotionCodes.create', [params], () => {
          if (!coupons.has(params.promotion.coupon)) throw err('resource_missing', 'No such coupon');
          const p = { id: id('promo'), code: params.code, active: true, max_redemptions: params.max_redemptions, metadata: params.metadata, coupon: params.promotion.coupon };
          promos.set(p.id, p);
          return p;
        }),
      update: (pid: string, params: { active: boolean }) =>
        op('promotionCodes.update', [pid, params], () => {
          const p = promos.get(pid)!;
          p.active = params.active;
          return p;
        }),
    },
    subscriptions: {
      retrieve: (sid: string) =>
        op('subscriptions.retrieve', [sid], () => {
          const s = subs.get(sid);
          if (!s) throw err('resource_missing');
          return structuredClone(s);
        }),
      update: (sid: string, params: { discounts: '' | { discount?: string; promotion_code?: string }[] }) =>
        op('subscriptions.update', [sid, params], () => {
          const s = subs.get(sid)!;
          s.discounts = params.discounts === '' ? [] : params.discounts.map((d) => d.discount ?? id('di'));
          return structuredClone(s);
        }),
    },
    customers: {
      create: (params: { metadata: Record<string, string> }, opts?: { idempotencyKey?: string }) =>
        op('customers.create', [params, opts], () => {
          if (opts?.idempotencyKey && idem.has(opts.idempotencyKey)) return idem.get(opts.idempotencyKey);
          const c = { id: id('cus'), metadata: params.metadata };
          customers.set(c.id, c);
          if (opts?.idempotencyKey) idem.set(opts.idempotencyKey, c);
          return c;
        }),
    },
    prices: {
      list: (params: { lookup_keys: string[] }) =>
        op('prices.list', [params], () => ({ data: params.lookup_keys.map((k) => ({ id: `price_${k}`, lookup_key: k })) })),
    },
    checkout: {
      sessions: {
        create: (params: Record<string, unknown>) =>
          op('checkout.sessions.create', [params], () => {
            const sid = `cs_test_${'a'.repeat(20)}${++n}`;
            const s = { id: sid, url: `https://checkout.stripe.com/c/pay/${sid}`, status: 'open', params, metadata: params.metadata, client_reference_id: params.client_reference_id, subscription: null as string | null, discounts: [] as { promotion_code: string }[] };
            sessions.set(sid, s);
            return s;
          }),
        retrieve: (sid: string) =>
          op('checkout.sessions.retrieve', [sid], () => {
            const s = sessions.get(sid);
            if (!s) throw err('resource_missing');
            return { ...s, subscription: s.subscription ? structuredClone(subs.get(s.subscription as string)) : null };
          }),
      },
    },
    billingPortal: {
      configurations: { list: () => op('billingPortal.configurations.list', [], () => ({ data: [{ id: 'bpc_1', metadata: { app: 'irreplaceable' } }] })) },
      sessions: {
        create: (params: { customer: string; return_url: string }) =>
          op('billingPortal.sessions.create', [params], () => ({ id: id('bps'), url: `https://billing.stripe.com/p/session/${params.customer}` })),
      },
    },
    products: {},
    webhooks,
  };

  /** Simulates the person paying on the Checkout page: the session completes with a subscription. */
  function completeSession(sid: string, sub: Partial<StubSub> = {}): StubSub {
    const s = sessions.get(sid)!;
    const params = s.params as {
      customer: string;
      metadata: Record<string, string>;
      line_items: { price: string }[];
      subscription_data?: { trial_period_days?: number; metadata?: Record<string, string> };
      discounts?: { promotion_code: string }[];
    };
    const lookupKey = params.line_items[0].price.replace(/^price_/, '');
    const interval = lookupKey.endsWith('monthly') ? 'month' : 'year';
    const now = Math.floor(Date.now() / 1000);
    const trial = params.subscription_data?.trial_period_days;
    const full: StubSub = {
      id: id('sub'),
      status: trial ? 'trialing' : 'active',
      customer: params.customer,
      trial_end: trial ? now + trial * 86400 : null,
      cancel_at: null,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      discounts: [],
      metadata: { ...params.subscription_data?.metadata, profileId: params.metadata.profileId },
      items: { data: [{ current_period_end: trial ? now + trial * 86400 : now + 365 * 86400, price: { lookup_key: lookupKey, recurring: { interval } } }] },
      ...sub,
    };
    subs.set(full.id, full);
    s.status = 'complete';
    s.subscription = full.id;
    s.discounts = params.discounts ?? [];
    return full;
  }

  return {
    stripe: stub as unknown as BillingStripe,
    calls,
    failNext,
    coupons,
    promos,
    subs,
    sessions,
    customers,
    completeSession,
    callsOf: (name: string) => calls.filter((c) => c.op === name),
  };
}

export type StripeStub = ReturnType<typeof createStripeStub>;
