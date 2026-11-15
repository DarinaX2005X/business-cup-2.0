import { createHash } from 'node:crypto';
import { clientIp, requireProfile } from '@/server/profile/http';
import type { CoachRequestCtx } from './service';

/**
 * The authenticated coach request: the profile, the client IP (for the per-IP model limit) and whose
 * conversation it is. A shared demo account is used by many judges at once, so there the conversation
 * and the daily cap belong to the device: the profile id plus a short hash of the device secret.
 */
export async function coachCtx(req: Request): Promise<CoachRequestCtx> {
  const profile = await requireProfile(req);
  const secret = req.headers.get('x-profile-secret') ?? '';
  const owner = profile.demo ? `${profile.id}:d${createHash('sha256').update(`irr:coach-device:${secret}`).digest('hex').slice(0, 16)}` : profile.id;
  return { profile, ip: clientIp(req), owner };
}
