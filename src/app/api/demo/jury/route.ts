/**
 * Deprecated alias of POST /api/auth/demo (the shared demo accounts). It no longer touches the caller's
 * own profile; the response carries the demo account's credentials to sign in with.
 */
export { POST } from '@/app/api/auth/demo/route';

export const maxDuration = 120;
