import { z } from 'zod';
import type { Locale, PointsAward, Profile } from '@/domain/types';
import { getStore, isConflictError, ConflictError } from '@/server/store';
import { runWithEventContext, type EmitResult } from '@/server/events';
import { planActive } from '@/server/billing/plan';

/** Coach access (round 3); `isPro` below is true for both paid tiers. */
export { isCoach } from '@/server/billing/plan';
import { hashSecret, isProfileId, isSecret, newProfileId, newSecret, verifySecret } from './ids';

export { isProfileId, isSecret } from './ids';

/**
 * Anonymous profiles: `profile:<id>` in the store, versioned. The client keeps id + secret;
 * the server keeps sha256(secret). All changes go through `updateProfile`, which re-reads,
 * applies the mutation and writes with the version it read, retrying on a race.
 */

export type PublicProfile = Omit<Profile, 'secretHash'>;

export const profileKey = (id: string) => `profile:${id}`;

export class ProfileNotFoundError extends Error {
  readonly code = 'not_found';
  constructor(id: string) {
    super(`profile ${id} not found`);
    this.name = 'ProfileNotFoundError';
  }
}

/** Minimal shape check of a stored record, so a corrupted or foreign value fails loudly instead of spreading. */
const storedProfileShape = z.looseObject({
  id: z.string(),
  secretHash: z.string().length(64),
  createdAt: z.string(),
  locale: z.enum(['en', 'ru', 'kk']),
  xrays: z.array(z.string()),
  reps: z.array(z.string()),
  points: z.looseObject({ balance: z.number(), events: z.array(z.unknown()) }),
  plan: z.looseObject({ status: z.enum(['free', 'trialing', 'pro']) }),
  streak: z.looseObject({ current: z.number() }),
});

function parseStored(value: unknown, version: number, id: string): Profile {
  const res = storedProfileShape.safeParse(value);
  if (!res.success || res.data.id !== id) throw new Error(`stored profile ${id} is malformed`);
  return { ...(value as Profile), version };
}

export function newProfileRecord(input: { id: string; secretHash: string; locale: Locale; tz: string | null; invitedBy?: string }): Profile {
  return {
    id: input.id,
    version: 1,
    secretHash: input.secretHash,
    createdAt: new Date().toISOString(),
    locale: input.locale,
    tz: input.tz,
    xrays: [],
    reps: [],
    repLog: [],
    trial: { status: 'available' },
    streak: { current: 0, best: 0, lastDay: null, days: [], freezes: 0 },
    points: { balance: 0, events: [] },
    redemptions: [],
    plan: { status: 'free' },
    proof: [],
    sound: true,
    hintsSeen: [],
    ...(input.invitedBy ? { invitedBy: input.invitedBy } : {}),
  };
}

export async function createProfile(input: { locale: Locale; tz?: string | null; invitedBy?: string | null }): Promise<{ profile: Profile; secret: string }> {
  const store = getStore();
  const secret = newSecret();
  let invitedBy: string | undefined;
  if (input.invitedBy && isProfileId(input.invitedBy) && (await store.get(profileKey(input.invitedBy)))) {
    invitedBy = input.invitedBy;
  }
  for (let i = 0; i < 3; i++) {
    const profile = newProfileRecord({ id: newProfileId(), secretHash: hashSecret(secret), locale: input.locale, tz: input.tz ?? null, invitedBy });
    try {
      await store.set(profileKey(profile.id), profile, { version: 0 });
      return { profile, secret };
    } catch (err) {
      if (!isConflictError(err)) throw err; // id collision: practically impossible, try a new id
    }
  }
  throw new Error('could not allocate a profile id');
}

export async function getProfile(id: string): Promise<Profile | null> {
  if (!isProfileId(id)) return null;
  const hit = await getStore().get<Profile>(profileKey(id));
  return hit ? parseStored(hit.value, hit.version, id) : null;
}

/** Profile for this id + secret, or null (unknown id, wrong secret, malformed input). Constant-time secret check. */
export async function authenticate(id: unknown, secret: unknown): Promise<Profile | null> {
  if (!isProfileId(id) || !isSecret(secret)) return null;
  const profile = await getProfile(id);
  if (!profile) return null;
  return verifySecret(secret, profile.secretHash) ? profile : null;
}

export function toPublicProfile(profile: Profile): PublicProfile {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secretHash, ...rest } = profile;
  return rest;
}

/**
 * A mutation receives a private copy of the current profile. It may change it in place and return
 * nothing, return a new profile, or return the result of `emit(...)`. It can run more than once
 * (on a race it is re-applied to the fresh profile), so it must not have outside side effects.
 * `id`, `secretHash`, `version` and `createdAt` cannot be changed by it.
 */
export type ProfileMutation = (profile: Profile) => Profile | EmitResult | void | Promise<Profile | EmitResult | void>;

export interface UpdateResult {
  profile: Profile;
  /** Points awarded by event subscribers during the successful attempt; routes return them as `pointsAwarded`. */
  awards: PointsAward[];
}

const MAX_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Updates to one profile inside one server instance run one after another, so requests from two tabs
 * that land on the same instance never race; across instances the versioned write + retry decides.
 */
const queues = new Map<string, Promise<unknown>>();

export function updateProfile(id: string, fn: ProfileMutation, opts: { current?: Profile } = {}): Promise<UpdateResult> {
  const prev = queues.get(id);
  // A profile the caller just read (e.g. while authenticating) saves one store round trip,
  // unless another update is queued ahead and will make it stale. The versioned write keeps this safe.
  const current = prev ? undefined : opts.current;
  const run = (prev ?? Promise.resolve()).catch(() => undefined).then(() => updateProfileOnce(id, fn, current));
  queues.set(id, run);
  void run.finally(() => {
    if (queues.get(id) === run) queues.delete(id);
  }).catch(() => undefined);
  return run;
}

async function updateProfileOnce(id: string, fn: ProfileMutation, known?: Profile): Promise<UpdateResult> {
  const store = getStore();
  let lastConflict: ConflictError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const current = attempt === 0 && known?.id === id ? known : await getProfile(id);
    if (!current) throw new ProfileNotFoundError(id);
    const { value, awards } = await runWithEventContext(id, async () => {
      const draft = structuredClone(current);
      const out = await fn(draft);
      return out === undefined ? draft : 'profile' in out && 'awards' in out ? out.profile : out;
    });
    const next: Profile = {
      ...value,
      id: current.id,
      secretHash: current.secretHash,
      createdAt: current.createdAt,
      version: current.version + 1,
    };
    try {
      const version = await store.set(profileKey(id), next, { version: current.version });
      return { profile: { ...next, version }, awards };
    } catch (err) {
      if (!isConflictError(err)) throw err;
      lastConflict = err;
      await sleep(10 * 2 ** attempt + Math.random() * 40 * (attempt + 1));
    }
  }
  throw lastConflict ?? new Error('updateProfile failed');
}

/**
 * Keys owned by a profile, removed on deletion. Packages that add per-profile keys extend this list
 * (via REQUESTS.md for 01.3): `xray:<id>` (02), `rep:<id>` (03).
 */
export async function profileOwnedKeys(profile: Profile): Promise<string[]> {
  const store = getStore();
  const rateKeys = await store.list(`rl:profile:${profile.id}:`);
  return [...profile.xrays.map((x) => `xray:${x}`), ...profile.reps.map((r) => `rep:${r}`), ...rateKeys];
}

/** Deletes the profile first (access stops at once), then everything it owns. */
export async function deleteProfile(id: string): Promise<void> {
  const profile = await getProfile(id);
  if (!profile) return;
  const store = getStore();
  const owned = await profileOwnedKeys(profile);
  await store.del(profileKey(id));
  await Promise.all(owned.map((k) => store.del(k)));
}

/**
 * Pro access: an active `pro`/`trialing` plan whose period has not ended (Stripe or the Business Cup
 * offer, see `planActive` in src/server/billing/plan.ts), or DEV_FORCE_PRO=1 outside production.
 */
export function isPro(profile: Pick<Profile, 'plan'>, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEV_FORCE_PRO === '1' && env.NODE_ENV !== 'production' && env.VERCEL_ENV !== 'production') return true;
  return planActive(profile.plan, now);
}
