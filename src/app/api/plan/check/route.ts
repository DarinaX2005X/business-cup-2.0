import { z } from 'zod';
import { checkPlanItem } from '@/server/growth';
import { clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({
  itemId: z.string().regex(/^[0-9A-Za-z]{8}-\d{1,2}-\d$/, 'itemId: expected <plan>-<week>-<n>'),
  done: z.boolean(),
  xray: z.string().regex(/^[0-9A-Za-z]{12}$/).nullish(),
});

/**
 * POST /api/plan/check { itemId, done, xray? } → { itemId, done, doneIds, pointsAwarded }.
 * Progress is stored on the profile; the first check of an item emits `plan_item_done` (15 points,
 * at most 10 items a day; unchecking keeps the points). 404 not_found, 402 pro_required (weeks 2–12 on Free).
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const res = await checkPlanItem({ profile, itemId: body.itemId, done: body.done, xrayId: body.xray, tz: clientTz(req) });
  return Response.json(res, { headers: { 'Cache-Control': 'no-store' } });
});
