import { withApi } from '@/server/profile/http';
import { clearHistory } from '@/server/coach/history';
import { coachCtx } from '@/server/coach/http';
import { coachState } from '@/server/coach/service';

/**
 * GET /api/coach → CoachState: access ('coach' | 'locked'), the person's snapshot, starter questions from
 * their data, the saved conversation (Coach only) and messages left today. 401 without a profile.
 */
export const GET = withApi(async (req: Request) => {
  const ctx = await coachCtx(req);
  return Response.json(await coachState(ctx), { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE /api/coach → { ok: true }: «New chat», empties the saved conversation. */
export const DELETE = withApi(async (req: Request) => {
  const ctx = await coachCtx(req);
  await clearHistory(ctx.owner ?? ctx.profile.id);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
});
