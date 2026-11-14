import { clientTz, requireProfile, withApi } from '@/server/profile/http';
import { getRep } from '@/server/reps';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/reps/:id → { rep: RepView } | 202 { status: 'generating', repId } (poll every 2 s).
 * 404 unknown or not yours; 503 generation_failed (nothing was kept; start the rep again).
 */
export const GET = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const profile = await requireProfile(req);
  const result = await getRep({ profile, headerTz: clientTz(req) }, id);
  return Response.json(result, { status: 'rep' in result ? 200 : 202, headers: { 'Cache-Control': 'no-store' } });
});
