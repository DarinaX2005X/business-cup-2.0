import { planSummaryFor } from '@/server/growth';
import { clientTz, requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/plan/progress?xray=<id> → PlanSummary for Home and Progress («Week 2 of 12», «3 of 5 done»,
 * the next item). Defaults to the latest map; `status: 'none'` until a plan was written. Never calls the model.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const raw = new URL(req.url).searchParams.get('xray');
  const xray = raw && /^[0-9A-Za-z]{12}$/.test(raw) ? raw : null;
  return Response.json(await planSummaryFor(profile, xray, clientTz(req)), { headers: { 'Cache-Control': 'no-store' } });
});
