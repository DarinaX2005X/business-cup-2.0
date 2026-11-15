import { z } from 'zod';
import { signup } from '@/server/auth';
import { clientIp, readJson, requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({ email: z.string().max(320), password: z.string().max(1024) });

/**
 * POST /api/auth/signup { email, password } with the current (guest) profile headers → 201 { email, id, secret }.
 * The account is attached to this profile, so its map, points and plan stay. The guest secret stops working:
 * this device continues with the new `secret` it gets here, and an old restore link no longer opens it.
 * 400 invalid_email / invalid_password, 401, 409 account_exists / email_taken, 429 rate_limited { retryAfter }.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  return Response.json(await signup(profile, body, clientIp(req)), { status: 201 });
});
