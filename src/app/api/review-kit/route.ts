import { z } from 'zod';
import { isPro } from '@/server/profile';
import { buildReviewKit } from '@/server/progress';
import { clientIp, HttpError, readJson, requireProfile, withApi } from '@/server/profile/http';

export const maxDuration = 60;

const bodySchema = z.object({ locale: z.enum(['en', 'ru', 'kk']) });

/**
 * POST /api/review-kit { locale } (Pro) → ReviewKitResponse: a one-page brief for a talk with one's
 * manager, in that language. 402 pro_required, 409 no_xray / no_proof, 503 ai_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { locale } = await readJson(req, bodySchema);
  if (!isPro(profile)) throw new HttpError(402, 'pro_required', 'The Review kit is part of Pro.');
  const kit = await buildReviewKit(profile, locale, { profileId: profile.id, ip: clientIp(req) });
  return Response.json(kit, { headers: { 'Cache-Control': 'no-store' } });
});
