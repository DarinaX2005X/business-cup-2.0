import { requireProfile, withApi } from '@/server/profile/http';
import { pointsView } from '@/server/points';

/**
 * GET /api/points → { balance, xp, level, levelName, levelLabel, levelAt, nextAt, weekXp, handle,
 * events (newest 50), rules, nextReward, available, freezes }. 401.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  return Response.json(await pointsView(profile), { headers: { 'Cache-Control': 'no-store' } });
});
