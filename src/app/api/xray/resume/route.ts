import { z } from 'zod';
import { clientIp, optionalProfile, readJson, withApi } from '@/server/profile/http';
import { analyzeResume } from '@/server/xray/resume';

// Two model calls in a row; each has its own 45 s timeout.
export const maxDuration = 60;

const bodySchema = z.object({
  // Larger input is accepted and cut to 20 000 characters (the response says `truncated`).
  text: z.string().trim().min(1, 'text: empty').max(200_000, 'text: too long'),
  mode: z.enum(['resume', 'description']),
  locale: z.enum(['en', 'ru', 'kk']),
});

/**
 * POST /api/xray/resume { text, mode, locale } → { facts, ranked: { code, title, localTitle, reason }[], confidence, truncated }
 * 422 not_a_resume | unclear_description | too_short | no_match (with `reason`), 503 ai_unavailable, 429 rate_limited.
 */
export const POST = withApi(async (req: Request) => {
  const body = await readJson(req, bodySchema);
  const profile = await optionalProfile(req).catch(() => null);
  const result = await analyzeResume({ ...body, actor: { profileId: profile?.id ?? null, ip: clientIp(req) } });
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
