import { isLocale } from '@/i18n/config';
import { isPro } from '@/server/profile';
import { buildPlan } from '@/server/progress';
import { clientTz, HttpError, requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/plan?locale= (Pro) → PlanResponse: 12 weeks in three months from the latest week map, each
 * with its focus, tasks and the reps done that week. 402 pro_required, 409 no_xray.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  if (!isPro(profile)) throw new HttpError(402, 'pro_required', 'The 90-day plan is part of Pro.');
  const q = new URL(req.url).searchParams.get('locale');
  const plan = await buildPlan(profile, { tz: clientTz(req), locale: isLocale(q) ? q : undefined });
  return Response.json(plan, { headers: { 'Cache-Control': 'no-store' } });
});
