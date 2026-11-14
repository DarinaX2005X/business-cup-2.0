import { z } from 'zod';
import { clientIp, HttpError, withApi } from '@/server/profile/http';
import { loadBundle } from '@/server/xray/data';
import { taskTextsEnsuring } from '@/server/xray/tips';

export const maxDuration = 60;

type Ctx = { params: Promise<{ code: string }> };

const localeSchema = z.enum(['en', 'ru', 'kk']).catch('en');

/**
 * GET /api/occupations/:code/texts?locale= → { tasks: Record<taskId, { text, short }>, ready }
 * English text and heuristic labels until the generated labels/translations exist (`ready: false`);
 * the first request also starts that generation.
 */
export const GET = withApi(async (req: Request, ctx: Ctx) => {
  const { code } = await ctx.params;
  const locale = localeSchema.parse(new URL(req.url).searchParams.get('locale') ?? 'en');
  const bundle = await loadBundle(decodeURIComponent(code));
  if (!bundle) throw new HttpError(404, 'not_found', 'Unknown occupation code.');
  const texts = await taskTextsEnsuring(bundle, locale, { ip: clientIp(req) });
  return Response.json(texts, { headers: { 'Cache-Control': texts.ready ? 'public, max-age=300, s-maxage=3600' : 'no-store' } });
});
