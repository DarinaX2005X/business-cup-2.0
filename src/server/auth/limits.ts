import { createHash } from 'node:crypto';
import { hashIp } from '@/server/ai/budget';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';

/**
 * Sign-in and sign-up attempts, counted in fixed 15-minute windows: 10 per email (guessing one
 * account's password) and a generous per-network cap (judges share one Wi-Fi). Every attempt counts,
 * successful or not. Keys expire with their window.
 */

export const WINDOW_SEC = 15 * 60;
export const PER_EMAIL = 10;
const perIp = () => {
  const n = Number(process.env.AUTH_IP_PER_WINDOW);
  return Number.isInteger(n) && n > 0 ? n : 300;
};

const emailBucket = (email: string) => createHash('sha256').update(`auth:${email}`).digest('hex').slice(0, 32);

export async function takeAuthAttempt(kind: 'login' | 'signup', ip: string, email: string, now: Date = new Date()): Promise<void> {
  const store = getStore();
  const window = Math.floor(now.getTime() / 1000 / WINDOW_SEC);
  const retryAfter = (window + 1) * WINDOW_SEC - Math.floor(now.getTime() / 1000);
  const [byEmail, byIp] = await Promise.all([
    store.incrFloat(`rl:auth:${kind}:email:${emailBucket(email)}:${window}`, 1, WINDOW_SEC + 60),
    store.incrFloat(`rl:auth:${kind}:ip:${hashIp(ip)}:${window}`, 1, WINDOW_SEC + 60),
  ]);
  if (byEmail > PER_EMAIL || byIp > perIp()) {
    throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, { retryAfter });
  }
}
