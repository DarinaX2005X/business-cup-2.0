import { requireProfile, withApi } from '@/server/profile/http';
import { pointsView } from '@/server/points';

/** GET /api/points → { balance, events (newest 50), rules, nextReward, available, freezes }. 401. */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  return Response.json(pointsView(profile), { headers: { 'Cache-Control': 'no-store' } });
});
