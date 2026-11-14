import { isLocale } from '@/i18n/config';
import { buildProgress } from '@/server/progress';
import { clientTz, requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/progress?locale= → ProgressResponse: the score line (a point per week map, per completed rep
 * and the latest change of the week), the streak with a 12-week calendar, counters and the proof list.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const q = new URL(req.url).searchParams.get('locale');
  const data = await buildProgress(profile, { tz: clientTz(req), locale: isLocale(q) ? q : undefined });
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
});
