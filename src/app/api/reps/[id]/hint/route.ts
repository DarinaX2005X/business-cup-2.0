import { z } from 'zod';
import { clientIp, clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';
import { slipHint } from '@/server/reps';

type Ctx = { params: Promise<{ id: string }> };

const range = z.tuple([z.number().int().min(0).max(100_000), z.number().int().min(0).max(100_000)]);
const bodySchema = z.object({ ranges: z.array(range).max(40).default([]) });

/**
 * POST /api/reps/:id/hint { ranges } (Spot the slip, before checking) → { hint: { start, end } | null,
 * hintsUsed, rep }: the paragraph where a mistake not covered by the current highlights sits. Each hint
 * takes 10 points off this rep when it is checked, never below the base. 400 not a slip, 404, 409 already_done.
 */
export const POST = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const profile = await requireProfile(req);
  const { ranges } = await readJson(req, bodySchema);
  return Response.json(await slipHint({ profile, headerTz: clientTz(req), ip: clientIp(req) }, id, ranges), { headers: { 'Cache-Control': 'no-store' } });
});
