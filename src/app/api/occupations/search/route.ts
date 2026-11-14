import { z } from 'zod';
import { clientIp, HttpError, withApi } from '@/server/profile/http';
import { QUERY_MAX, QUERY_MIN, searchTitles } from '@/server/xray/search';

const querySchema = z.object({
  q: z.string().trim().min(QUERY_MIN, `q: at least ${QUERY_MIN} characters`).max(QUERY_MAX, `q: at most ${QUERY_MAX} characters`),
  locale: z.enum(['en', 'ru', 'kk']).catch('en'),
});

/** GET /api/occupations/search?q=&locale= → { results, suggestions, translated, hint } */
export const GET = withApi(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? '', locale: url.searchParams.get('locale') ?? 'en' });
  if (!parsed.success) throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
  // No profile lookup here: it would cost a store round trip on every keystroke. The rare model call
  // (Cyrillic title not in the index) is limited per IP.
  const body = await searchTitles(parsed.data.q, parsed.data.locale, { ip: clientIp(req) });
  return Response.json(body, {
    // Same query, same data: cacheable unless the translation path failed (then a retry may succeed).
    headers: { 'Cache-Control': body.hint ? 'no-store' : 'public, max-age=300, s-maxage=86400' },
  });
});
