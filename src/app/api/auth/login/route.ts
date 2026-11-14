import { z } from 'zod';
import { login } from '@/server/auth';
import { clientIp, readJson, withApi } from '@/server/profile/http';

const bodySchema = z.object({ email: z.string().max(320), password: z.string().max(1024) });

/**
 * POST /api/auth/login { email, password } → { id, secret, email }: a new device secret for that account's
 * profile (store it like a profile created here). 401 invalid_login (same answer for an unknown email and a
 * wrong password), 429 rate_limited { retryAfter } after 10 attempts per email in 15 minutes.
 */
export const POST = withApi(async (req: Request) => {
  const body = await readJson(req, bodySchema);
  return Response.json(await login(body, clientIp(req)), { headers: { 'Cache-Control': 'no-store' } });
});
