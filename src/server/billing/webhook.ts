import type Stripe from 'stripe';
import { getProfile, isProfileId } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { savePlanFromSubscription } from './sync';
import { getStripe, stripeCall } from './stripe';

/**
 * Optional webhook (04.1.3, P2): active only when STRIPE_WEBHOOK_SECRET is set. Verifies the
 * signature over the raw body, then for subscription events reads the subscription again (events
 * can arrive out of order, the current object cannot) and writes it into the profile named in
 * `metadata.profileId`. Without the webhook the same sync happens when an expired plan is read.
 */

const SUBSCRIPTION_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);

export async function handleWebhook(rawBody: string, signature: string | null, secret: string, now: Date = new Date()): Promise<{ received: true; type: string; updated: boolean }> {
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature ?? '', secret);
  } catch {
    throw new HttpError(400, 'invalid_signature', 'Webhook signature check failed.');
  }
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return { received: true, type: event.type, updated: false };
  const payload = event.data.object as Stripe.Subscription;
  const profileId = payload.metadata?.profileId;
  if (!isProfileId(profileId) || !(await getProfile(profileId))) return { received: true, type: event.type, updated: false };
  const sub = await stripeCall('subscription', (s) => s.subscriptions.retrieve(payload.id));
  const saved = await savePlanFromSubscription(profileId, sub, now, { adopt: event.type !== 'customer.subscription.deleted' });
  return { received: true, type: event.type, updated: saved.plan.subscriptionId === sub.id };
}
