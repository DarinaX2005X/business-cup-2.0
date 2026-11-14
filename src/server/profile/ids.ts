import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const PROFILE_ID_RE = /^[0-9A-Za-z]{22}$/;
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** 22 base62 characters (~131 bits), unbiased (rejection sampling). */
export function newProfileId(): string {
  let out = '';
  while (out.length < 22) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < 22) out += BASE62[b % 62];
    }
  }
  return out;
}

/** 32 random bytes, base64url (43 characters). Shown to the client once; the server keeps only its hash. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of sha256(secret) with the stored hash. */
export function verifySecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isProfileId = (v: unknown): v is string => typeof v === 'string' && PROFILE_ID_RE.test(v);
export const isSecret = (v: unknown): v is string => typeof v === 'string' && SECRET_RE.test(v);
