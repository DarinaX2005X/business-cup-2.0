import { readBoard } from '@/server/leaderboard';
import { optionalProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/leaderboard (profile headers optional) → { week, top: { rank, handle, xp, you }[] (up to 50),
 * you: { rank, xp, handle } | null, players }. This ISO week's XP, real profiles only.
 */
export const GET = withApi(async (req: Request) => {
  const viewer = await optionalProfile(req);
  return Response.json(await readBoard(viewer), { headers: { 'Cache-Control': 'no-store' } });
});
