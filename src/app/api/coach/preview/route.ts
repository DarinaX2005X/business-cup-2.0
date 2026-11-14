import { withApi } from '@/server/profile/http';
import { coachCtx } from '@/server/coach/http';
import { coachPreview } from '@/server/coach/service';

export const maxDuration = 60;

/**
 * POST /api/coach/preview → CoachPreview { question, answer, basis }: one real coach answer on the person's
 * own week, shown locked to Free and Pro. Cached per week map. 409 no_xray, 503 ai_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const ctx = await coachCtx(req);
  return Response.json(await coachPreview(ctx), { headers: { 'Cache-Control': 'no-store' } });
});
