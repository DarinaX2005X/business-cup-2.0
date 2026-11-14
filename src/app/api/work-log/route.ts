import { z } from 'zod';
import { clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';
import { logWork } from '@/server/reps';

const bodySchema = z.object({
  taskId: z.string().min(1).max(16),
  minutes: z.number().int().min(5).max(240),
});

/** POST /api/work-log { taskId, minutes } → 201 { entry, minutesToday, pointsAwarded }. 400, 409 no_xray, 429 work_log_limit. */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  return Response.json(await logWork(profile, clientTz(req), body), { status: 201 });
});
