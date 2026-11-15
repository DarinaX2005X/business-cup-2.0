import type { Profile } from '@/domain/types';
import { deviceHashes, emailIndexKey, getProfile, hashSecret, newSecret, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { takeAuthAttempt } from './limits';
import { DEMO_EMAIL_DOMAIN, dummyVerify, hashPassword, normalizeEmail, validPassword, verifyPassword, PASSWORD_LENGTH } from './password';

/**
 * Email accounts on top of the anonymous profiles. A profile keeps its id; an account adds
 * `account: { email, passwordHash, createdAt }` and an index `acct:<sha256(email)>` → `{ profileId }`
 * (unique: created only if absent). Each signed-in browser holds its own device secret; the profile
 * keeps their sha256 in `secretHashes` (oldest dropped past the cap). Log in adds one, log out removes
 * the current one, so other devices stay signed in.
 */

export { DEMO_EMAIL_DOMAIN, hashPassword, normalizeEmail, PASSWORD_LENGTH, verifyPassword } from './password';
export { takeAuthAttempt, PER_EMAIL, WINDOW_SEC } from './limits';

/** Signed-in devices kept per account; the shared demo accounts keep more (many judges at once). */
export const DEVICE_CAP = 10;
export const DEMO_DEVICE_CAP = 200;

const capOf = (p: Pick<Profile, 'demo'>) => (p.demo ? DEMO_DEVICE_CAP : DEVICE_CAP);

/** The device list with `hash` added last; the oldest are dropped past `cap`. */
export function withDevice(profile: Pick<Profile, 'secretHash' | 'secretHashes'>, hash: string, cap: number): string[] {
  const list = [...deviceHashes(profile).filter((h) => h !== hash), hash];
  return list.slice(Math.max(0, list.length - cap));
}

/** A new device secret for this profile (shown once). */
export async function issueDeviceSecret(profileId: string): Promise<string> {
  const secret = newSecret();
  const hash = hashSecret(secret);
  await updateProfile(profileId, (p) => {
    p.secretHashes = withDevice(p, hash, capOf(p));
  });
  return secret;
}

interface EmailIndex {
  profileId: string;
  createdAt: string;
}

export async function profileByEmail(email: string): Promise<Profile | null> {
  const hit = await getStore().get<EmailIndex>(emailIndexKey(email));
  if (!hit) return null;
  const profile = await getProfile(hit.value.profileId);
  return profile?.account?.email === email ? profile : null;
}

function credentials(input: { email: unknown; password: unknown }): { email: string; password: string } {
  const email = normalizeEmail(input.email);
  if (!email) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  if (!validPassword(input.password)) {
    throw new HttpError(400, 'invalid_password', `Use a password of ${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters.`);
  }
  return { email, password: input.password };
}

/**
 * Attaches an email account to the current (guest) profile, so everything in it stays. The device secret
 * is rotated: every guest secret stops working (one may have travelled in a restore link) and this device
 * gets a new one, returned once. 409 account_exists (this profile already has one), 409 email_taken,
 * 400 invalid_email / invalid_password.
 */
export async function signup(profile: Profile, input: { email: unknown; password: unknown }, ip: string, now: Date = new Date()): Promise<{ email: string; id: string; secret: string }> {
  if (profile.account) throw new HttpError(409, 'account_exists', 'This profile already has an account. Log out to make another one.', { email: profile.account.email });
  const { email, password } = credentials(input);
  if (email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  await takeAuthAttempt('signup', ip, email, now);
  const passwordHash = await hashPassword(password);

  const store = getStore();
  const key = emailIndexKey(email);
  const secret = newSecret();
  try {
    await store.set<EmailIndex>(key, { profileId: profile.id, createdAt: now.toISOString() }, { version: 0 });
  } catch (err) {
    if (!isConflictError(err)) throw err;
    throw new HttpError(409, 'email_taken', 'An account with this email already exists. Log in instead.');
  }
  try {
    await updateProfile(
      profile.id,
      (p) => {
        if (p.account) throw new HttpError(409, 'account_exists', 'This profile already has an account.', { email: p.account.email });
        p.account = { email, passwordHash, createdAt: now.toISOString() };
        // a fresh secret for this device only: guest secrets (restore links) are revoked
        p.secretHashes = [hashSecret(secret)];
      },
      { current: profile },
    );
  } catch (err) {
    // the index must not point at a profile without this account
    const hit = await store.get<EmailIndex>(key).catch(() => null);
    if (hit?.value.profileId === profile.id) await store.del(key).catch(() => undefined);
    throw err;
  }
  return { email, id: profile.id, secret };
}

const INVALID_LOGIN = () => new HttpError(401, 'invalid_login', 'That email and password do not match an account.');

/** Email + password → a new device secret for that account's profile. One generic 401 for every miss. */
export async function login(input: { email: unknown; password: unknown }, ip: string, now: Date = new Date()): Promise<{ id: string; secret: string; email: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password.slice(0, PASSWORD_LENGTH.max) : '';
  await takeAuthAttempt('login', ip, email ?? 'invalid', now);
  const profile = email ? await profileByEmail(email) : null;
  if (!profile?.account) {
    await dummyVerify(password);
    throw INVALID_LOGIN();
  }
  if (!validPassword(password) || !(await verifyPassword(password, profile.account.passwordHash))) throw INVALID_LOGIN();
  const secret = await issueDeviceSecret(profile.id);
  return { id: profile.id, secret, email: profile.account.email };
}

/**
 * Signs this device out: its secret stops working, other devices stay signed in. A guest profile
 * (no account) cannot log out: without an account its data could never be opened again.
 */
export async function logout(profile: Profile, secret: string): Promise<{ ok: true }> {
  if (!profile.account) throw new HttpError(409, 'no_account', 'This profile has no account yet. Create one first, or your progress cannot be opened again.');
  const hash = hashSecret(secret);
  await updateProfile(profile.id, (p) => {
    p.secretHashes = deviceHashes(p).filter((h) => h !== hash);
  });
  return { ok: true };
}
