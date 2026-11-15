import { z } from 'zod';
import { isAiError } from '@/server/ai/client';
import { clientIp, HttpError, optionalProfile, readJson, withApi } from '@/server/profile/http';
import { loadBundle, OCC_CODE_RE } from '@/server/xray/data';
import { proposeWeek, typicalWeek } from '@/server/xray/week';

export const maxDuration = 300;

const dutySchema = z.object({ original: z.string().trim().min(1).max(300), en: z.string().trim().min(1).max(300) });

const bodySchema = z.object({
  occupationCode: z.string().regex(OCC_CODE_RE, 'occupationCode: expected an O*NET-SOC code like 29-1141.00'),
  duties: z.array(dutySchema).max(20).nullish(),
  locale: z.enum(['en', 'ru', 'kk']),
});

/**
 * POST /api/xray/week { occupationCode, duties?, locale } → { shares, matches, unmappedDuties, source }
 * 404 unknown occupation; 503 ai_unavailable carries `fallback` (the typical week) so the flow can continue.
 */
export const POST = withApi(async (req: Request) => {
  const body = await readJson(req, bodySchema);
  const bundle = await loadBundle(body.occupationCode);
  if (!bundle) throw new HttpError(404, 'not_found', 'Unknown occupation code.');
  const duties = body.duties ?? [];
  if (!duties.length) return Response.json(typicalWeek(bundle));

  const profile = await optionalProfile(req).catch(() => null);
  try {
    const week = await proposeWeek({ bundle, duties, locale: body.locale, actor: { profileId: profile?.id ?? null, ip: clientIp(req) } });
    return Response.json(week, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (!isAiError(err)) throw err;
    const fallback = { ...typicalWeek(bundle), unmappedDuties: duties.map((d) => d.original) };
    if (err.code === 'rate_limited') throw new HttpError(429, 'rate_limited', err.message, { fallback });
    throw new HttpError(503, 'ai_unavailable', `AI unavailable (${err.code}); the typical week is in fallback.`, { fallback });
  }
});
