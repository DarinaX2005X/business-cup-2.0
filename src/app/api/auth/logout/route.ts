import { logout } from '@/server/auth';
import { requireProfile, withApi } from '@/server/profile/http';

/**
 * POST /api/auth/logout with the profile headers → { ok: true }: this device's secret stops working,
 * other signed-in devices stay. 401, 409 no_account (a guest profile cannot log out: nothing could open it again).
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  return Response.json(await logout(profile, req.headers.get('x-profile-secret') ?? ''));
});
