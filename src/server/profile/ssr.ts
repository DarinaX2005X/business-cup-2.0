import { cookies } from 'next/headers';
import { authenticate, toPublicProfile, type PublicProfile } from './index';

/** Cookie written by the client next to localStorage: `<id>.<secret>`, SameSite=Lax, 400 days. */
export const PROFILE_COOKIE = 'irr_p';

/**
 * The visitor's profile for server rendering (server components, route handlers), or null.
 * Read-only use: mutations must authenticate with headers (no cookie-authenticated writes, so no CSRF surface).
 */
export async function getProfileFromCookies(): Promise<PublicProfile | null> {
  const raw = (await cookies()).get(PROFILE_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  try {
    const profile = await authenticate(raw.slice(0, dot), raw.slice(dot + 1));
    return profile ? toPublicProfile(profile) : null;
  } catch (err) {
    console.error('[profile] cookie lookup failed', err);
    return null;
  }
}
