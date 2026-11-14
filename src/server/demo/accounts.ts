import { randomBytes } from 'node:crypto';
import type { Actor } from '@/server/ai/budget';
import { DEMO_EMAIL_DOMAIN, issueDeviceSecret, profileByEmail } from '@/server/auth';
import { createProfile, deleteProfile, emailIndexKey, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { buildDemoMap, type JuryPersona } from './jury';

/**
 * Shared demo accounts (Business Cup 2.0 jury): one per persona and environment, signed in by email
 * `demo-<persona>@irreplaceable.demo` (no password works for it). The first click builds it with the
 * live pipeline (about 20 s) under a lock, so parallel clicks never make two; later clicks get the
 * same account with a new device secret at once. A click that finds the account being built waits for it.
 */

export const demoEmail = (persona: JuryPersona) => `demo-${persona}@${DEMO_EMAIL_DOMAIN}`;

/** Time zone of each sample résumé's city, so "today" matches the persona. */
export const PERSONA_TZ: Record<JuryPersona, string> = { nurse: 'America/Chicago', software: 'America/Chicago', accountant: 'America/New_York' };
/** A password hash value that never matches (not in the scrypt format). */
const NO_PASSWORD = 'none';

const LOCK_SEC = 180;
const WAIT_MS = 100_000;
const POLL_MS = 1_500;

export interface DemoAccount {
  id: string;
  secret: string;
  email: string;
  /** the week map of this persona */
  xrayId: string | null;
  /** true when this request built the account */
  created: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(persona: JuryPersona): Promise<DemoAccount | null> {
  const profile = await profileByEmail(demoEmail(persona));
  if (!profile) return null;
  const secret = await issueDeviceSecret(profile.id);
  return { id: profile.id, secret, email: demoEmail(persona), xrayId: profile.demoXrays?.[persona] ?? profile.lastXrayId ?? null, created: false };
}

export async function openDemoAccount(persona: JuryPersona, actor: Actor, now: Date = new Date()): Promise<DemoAccount> {
  const ready = await signIn(persona);
  if (ready) return ready;

  const store = getStore();
  const lock = `lock:demo:${persona}`;
  const token = randomBytes(8).toString('hex');
  if (!(await store.setNx(lock, token, LOCK_SEC))) {
    // another request is building it: wait for it instead of building a second one
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      const done = await signIn(persona);
      if (done) return done;
      if (!(await store.setNx(lock, token, LOCK_SEC))) continue;
      // the builder gave up (its lock is gone): build it here
      return build(persona, actor, now, lock, token);
    }
    throw new HttpError(503, 'demo_unavailable', 'The demo account is still being prepared. Try again in a moment.');
  }
  return build(persona, actor, now, lock, token);
}

async function build(persona: JuryPersona, actor: Actor, now: Date, lock: string, token: string): Promise<DemoAccount> {
  const store = getStore();
  try {
    const again = await signIn(persona); // finished elsewhere between the check and the lock
    if (again) return again;
    const email = demoEmail(persona);
    const { profile, secret } = await createProfile({ locale: 'en', tz: PERSONA_TZ[persona] });
    try {
      const { xrayId } = await buildDemoMap(profile, persona, { ...actor, profileId: profile.id }, now);
      await updateProfile(profile.id, (p) => {
        p.account = { email, passwordHash: NO_PASSWORD, createdAt: now.toISOString() };
        p.secretHashes = p.secretHashes ?? [p.secretHash];
      });
      try {
        await store.set(emailIndexKey(email), { profileId: profile.id, createdAt: now.toISOString() }, { version: 0 });
      } catch (err) {
        if (!isConflictError(err)) throw err;
        // someone else's account won the email: use it and drop this one
        await deleteProfile(profile.id).catch(() => undefined);
        const theirs = await signIn(persona);
        if (theirs) return theirs;
        throw err;
      }
      return { id: profile.id, secret, email, xrayId, created: true };
    } catch (err) {
      // no half-built demo account stays behind (its map, reps and keys go with it)
      const stillOurs = (await store.get<{ profileId: string }>(emailIndexKey(email)).catch(() => null))?.value.profileId === profile.id;
      if (!stillOurs) await deleteProfile(profile.id).catch(() => undefined);
      throw err;
    }
  } finally {
    await store.delIfEquals(lock, token).catch(() => undefined);
  }
}
