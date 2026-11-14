import { z } from 'zod';
import { clientIp, HttpError, withApi } from '@/server/profile/http';
import { loadBundle, OCC_CODE_RE } from '@/server/xray/data';
import { ensureTips, tipsResponse } from '@/server/xray/tips';

// Generation runs in after() within this route's duration.
export const maxDuration = 60;

const querySchema = z.object({
  code: z.string().regex(OCC_CODE_RE, 'code: expected an O*NET-SOC code like 29-1141.00'),
  locale: z.enum(['en', 'ru', 'kk']).catch('en'),
});

/**
 * GET /api/xray/tips?code=&locale= → { tips: Record<taskId, { short, tip, kind, edgeTip }> }
 * | { pending: true } (generation started or running; poll) | { unavailable: true } (model failed; hide the block).
 */
export const GET = withApi(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ code: url.searchParams.get('code') ?? '', locale: url.searchParams.get('locale') ?? 'en' });
  if (!parsed.success) throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
  const bundle = await loadBundle(parsed.data.code);
  if (!bundle) throw new HttpError(404, 'not_found', 'Unknown occupation code.');
  const state = await ensureTips(bundle, parsed.data.locale, { ip: clientIp(req) });
  if (state.status === 'ready') {
    return Response.json({ tips: tipsResponse(state.record, bundle) }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } });
  }
  return Response.json(state.status === 'pending' ? { pending: true } : { unavailable: true }, { headers: { 'Cache-Control': 'no-store' } });
});
