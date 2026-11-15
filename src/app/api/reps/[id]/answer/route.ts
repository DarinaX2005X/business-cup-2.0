import { z } from 'zod';
import { clientIp, clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';
import { answerRep } from '@/server/reps';

type Ctx = { params: Promise<{ id: string }> };

// rep.delegate.run, rep.edge.reply and rep.grade may each take up to ~45 s.
export const maxDuration = 300;

const range = z.tuple([z.number().int().min(0).max(100_000), z.number().int().min(0).max(100_000)]);

const bodySchema = z.union([
  z.object({ step: z.literal('instruction'), instruction: z.string().trim().min(30, 'instruction: at least 30 characters').max(1200) }),
  z.object({ step: z.literal('review'), ranges: z.array(range).max(40), fix: z.string().max(400) }),
  z.object({ ranges: z.array(range).max(40) }),
  z.object({ message: z.string().trim().min(1).max(600) }),
  z.object({ finish: z.literal(true) }),
]);

/**
 * POST /api/reps/:id/answer
 *   slip: { ranges }  ·  delegate: { step: 'instruction', instruction } then { step: 'review', ranges, fix }
 *   edge: { message } (up to 6) or { finish: true }
 * → { rep: RepView, pointsAwarded, streak }. 409 already_done / already_run / no_replies_left / conflict.
 */
export const POST = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const result = await answerRep({ profile, headerTz: clientTz(req), ip: clientIp(req) }, id, body);
  return Response.json(result);
});
