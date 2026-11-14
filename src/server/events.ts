import { AsyncLocalStorage } from 'node:async_hooks';
import type { PointsAward, Profile } from '@/domain/types';
import { subscribers } from './events.register';

/**
 * Product events. `emit` runs the registered subscribers synchronously on the profile being updated
 * and returns the changed profile plus the points they awarded. It may only be called inside
 * `updateProfile(id, fn)`, so whatever subscribers change is written in the same version as the
 * change that caused the event (and is re-applied cleanly if that write has to be retried).
 *
 * Idempotency is the subscriber's job: the same `ref` (e.g. a rep id) can arrive again after a retry
 * or a repeated request, and a subscriber must not award twice for it (check `profile.points.events`).
 */

export type ProductEventType =
  | 'xray_completed'
  | 'week_confirmed'
  | 'rep_completed'
  | 'ai_or_me'
  | 'used_at_work'
  | 'proof_shared'
  | 'review_kit'
  | 'invite_completed'
  | 'pivot_explored'
  | 'cup_unlocked';

export interface ProductEvent {
  type: ProductEventType;
  /** Stable id of the thing that happened (xray id, rep id, round id, `<day>:<taskId>` …). */
  ref: string;
  data?: Record<string, unknown>;
  /** ISO time; defaults to now. */
  at?: string;
}

export interface EmitResult {
  profile: Profile;
  awards: PointsAward[];
}

/** A subscriber returns the (possibly new) profile and its awards, or nothing when the event does not concern it. */
export type Subscriber = (profile: Profile, event: ProductEvent & { at: string }) => { profile: Profile; awards?: PointsAward[] } | void;

interface UpdateContext {
  profileId: string;
  awards: PointsAward[];
}

const context = new AsyncLocalStorage<UpdateContext>();

/** Used by updateProfile: runs one attempt of the mutation with a fresh award list. */
export function runWithEventContext<T>(profileId: string, fn: () => Promise<T>): Promise<{ value: T; awards: PointsAward[] }> {
  const ctx: UpdateContext = { profileId, awards: [] };
  return context.run(ctx, async () => ({ value: await fn(), awards: ctx.awards }));
}

export function emit(profile: Profile, event: ProductEvent, list: readonly Subscriber[] = subscribers): EmitResult {
  const ctx = context.getStore();
  if (!ctx) throw new Error(`emit(${event.type}) must be called inside updateProfile(id, fn)`);
  if (ctx.profileId !== profile.id) throw new Error('emit() got a profile other than the one being updated');
  const full = { ...event, at: event.at ?? new Date().toISOString() };
  let current = profile;
  const awards: PointsAward[] = [];
  for (const sub of list) {
    const res = sub(current, full);
    if (!res) continue;
    current = res.profile;
    if (res.awards?.length) awards.push(...res.awards);
  }
  ctx.awards.push(...awards);
  return { profile: current, awards };
}
