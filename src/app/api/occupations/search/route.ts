import { z } from 'zod';
import { clientIp, HttpError, withApi } from '@/server/profile/http';
import { QUERY_MIN, searchTitles } from '@/server/xray/search';

const querySchema = z.object({
  // Longer text is cut to 100 characters by searchTitles, not rejected.
  q: z.string().trim().min(QUERY_MIN, `q: at least ${QUERY_MIN} characters`).max(2000, 'q: too long'),
  locale: z.enum(['en', 'ru', 'kk']).catch('en'),
  // 0 while the user is typing (local index only); 1 (default) after a pause or Enter, may call the model.
  translate: z.enum(['0', '1']).catch('1'),
});

/** GET /api/occupations/search?q=&locale=&translate=0|1 → { results, suggestions, translated, hint, translatable? } */
export const GET = withApi(async (req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? '', locale: url.searchParams.get('locale') ?? 'en', translate: url.searchParams.get('translate') ?? '1' });
  if (!parsed.success) throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
  // No profile lookup here: it would cost a store round trip on every keystroke. The rare model call
  // (Cyrillic title not in the index) is limited per IP.
  const body = await searchTitles(parsed.data.q, parsed.data.locale, { ip: clientIp(req) }, { translate: parsed.data.translate === '1' });
  return Response.json(body, {
    // Same query, same data: cacheable unless the translation path failed (then a retry may succeed).
    headers: { 'Cache-Control': body.hint ? 'no-store' : 'public, max-age=300, s-maxage=86400' },
  });
});
