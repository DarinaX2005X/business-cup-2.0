/**
 * Deprecated alias of POST /api/auth/demo (a private copy of a jury demo account). It no longer touches the caller's
 * own profile; the response carries the demo account's credentials to sign in with.
 */
export { POST } from '@/app/api/auth/demo/route';

export const maxDuration = 300;
