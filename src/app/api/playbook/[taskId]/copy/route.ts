import { clientIp, clientTz, requireProfile, withApi } from '@/server/profile/http';
import { recordCopy } from '@/server/playbook';

type Ctx = { params: Promise<{ taskId: string }> };

/**
 * POST /api/playbook/:taskId/copy → { pointsAwarded, copiedToday }: «Copy instruction» counts as using
 * it at work (event used_at_work, once a day per task, 10 minutes). 402 for a locked card, 404.
 */
export const POST = withApi(async (req: Request, ctx: Ctx) => {
  const { taskId } = await ctx.params;
  const profile = await requireProfile(req);
  if (!/^[0-9A-Za-z_-]{1,16}$/.test(taskId)) return Response.json({ error: { code: 'not_found', message: 'Unknown task.' } }, { status: 404 });
  const result = await recordCopy({ profile, locale: profile.locale, headerTz: clientTz(req), ip: clientIp(req) }, taskId);
  return Response.json(result);
});
