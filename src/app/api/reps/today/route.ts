import { clientTz, requireProfile, withApi } from '@/server/profile/http';
import { getToday } from '@/server/reps';

/**
 * GET /api/reps/today (x-tz) → { day, daily, extras, extrasLeft, choices, nextKind, choiceTasks, streak,
 * aiOrMe, tomorrow } plus { status: 'generating', repId, pendingKind } while a rep is being written.
 * Free: 402 { error: pro_required, trial, aiOrMe, hasXray, tomorrow, streak }. Pro without a map: 409 no_xray.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const today = await getToday({ profile, headerTz: clientTz(req) });
  return Response.json(today, { headers: { 'Cache-Control': 'no-store' } });
});
