import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from 'zod';

/**
 * Password hashing with Node's scrypt (memory-hard), a random 16-byte salt per account and a
 * constant-time comparison. Stored as `scrypt$<N>$<r>$<p>$<salt b64>$<key b64>` so the cost can be raised
 * later without breaking older hashes. A stored value without that form never matches.
 */

const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LEN = 64;

export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

const FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;
const DUMMY_SALT = randomBytes(16);

/** True when the password matches the stored hash. Takes the same time for a malformed hash (dummy work). */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const m = stored ? FORMAT.exec(stored) : null;
  if (!m) {
    await derive(password, DUMMY_SALT, COST);
    return false;
  }
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (N > 1 << 20 || r > 32 || p > 4) return false; // refuse costs we never write
  const expected = Buffer.from(m[5], 'base64');
  const key = await derive(password, Buffer.from(m[4], 'base64'), { N, r, p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Same cost as a real check, for a sign-in with an unknown email. */
export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, null);
}

/** Emails ending here are reserved for the shared demo accounts. */
export const DEMO_EMAIL_DOMAIN = 'irreplaceable.demo';

const emailSchema = z.email().max(254);

/** Trimmed and lowercased email, or null when it is not a valid address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

export const validPassword = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= PASSWORD_LENGTH.min && pw.length <= PASSWORD_LENGTH.max;
