import { after } from 'next/server';
import { z } from 'zod';
import { clientIp, clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';
import { createRep } from '@/server/reps';

// Generation continues in after() when it takes longer than 8 s; the client polls GET /api/reps/:id.
export const maxDuration = 300;

const bodySchema = z.object({
  type: z.enum(['slip', 'delegate', 'edge']),
  kind: z.enum(['daily', 'extra']),
  /** "Practise this": a task of the person's week; an unknown id is ignored and the task is chosen as usual. */
  taskId: z.string().trim().max(16).regex(/^[0-9A-Za-z.-]+$/).nullish().catch(null),
});

/**
 * POST /api/reps { type, kind, taskId? } (Pro) → 201 { rep: RepView } | 202 { status: 'generating', repId }.
 * 402 pro_required, 409 daily_exists (with the existing rep or its state), 409 no_xray, 429 extra_limit.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const result = await createRep(
    { profile, headerTz: clientTz(req), ip: clientIp(req), defer: (job) => after(() => job) },
    body,
  );
  return Response.json(result, { status: 'rep' in result ? 201 : 202 });
});
