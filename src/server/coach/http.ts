import { clientIp, requireProfile } from '@/server/profile/http';
import type { CoachRequestCtx } from './service';

/** The authenticated coach request: the profile and the client IP (for the per-IP model limit). */
export async function coachCtx(req: Request): Promise<CoachRequestCtx> {
  const profile = await requireProfile(req);
  return { profile, ip: clientIp(req) };
}
