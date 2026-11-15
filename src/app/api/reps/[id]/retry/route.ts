import { after } from 'next/server';
import { clientIp, clientTz, requireProfile, withApi } from '@/server/profile/http';
import { retryRep } from '@/server/reps/service';

type Ctx = { params: Promise<{ id: string }> };

// The model client retries and fails over between models; a rewrite may continue in after().
export const maxDuration = 300;

/**
 * POST /api/reps/:id/retry → rewrites a rep that could not be written, under the same id, live:
 * 200 { rep } | 202 { status: 'generating', repId } | 503 generation_failed { repId, retryable } again.
 * A rep that already exists or is being written is returned as it is. 404 for someone else's rep.
 */
export const POST = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const profile = await requireProfile(req);
  const result = await retryRep({ profile, headerTz: clientTz(req), ip: clientIp(req), defer: (job) => after(() => job) }, id);
  return Response.json(result, { status: 'rep' in result ? 200 : 202 });
});
