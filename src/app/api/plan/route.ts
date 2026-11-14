import { z } from 'zod';
import { getPlan, refreshPlan } from '@/server/growth';
import { clientIp, clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';

// Writing a plan is one model call plus at most one repair round, each with the client's retries and failover.
export const maxDuration = 120;

const xraySchema = z.string().regex(/^[0-9A-Za-z]{12}$/);

/**
 * GET /api/plan?xray=<id> → PlanResponse (200) | { status: 'generating', xrayId } (202, ask again in a few
 * seconds). The first request for a map writes its 12-week plan (plan.generate) and stores it; later ones
 * read it, with `stale: true` once the map or the skills changed. Pro and Coach see all weeks; Free sees
 * week 1 and locked shells. `generate=0` only reads (404 no_plan when none exists, used by the PDF report).
 * 404 not_found, 409 no_xray, 503 ai_unavailable (nothing is stored then).
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const raw = new URL(req.url).searchParams.get('xray');
  const xray = raw ? xraySchema.safeParse(raw) : null;
  const generate = new URL(req.url).searchParams.get('generate') !== '0';
  const res = await getPlan({ profile, xrayId: xray?.success ? xray.data : null, actor: { profileId: profile.id, ip: clientIp(req) }, tz: clientTz(req), generate });
  return Response.json(res, { status: res.status === 'generating' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } });
});

const postSchema = z.object({ xray: xraySchema.nullish(), refresh: z.literal(true) });

/**
 * POST /api/plan { xray, refresh: true } → PlanResponse | 202 generating: rewrites a stale plan from the
 * current week on, keeping the weeks already under way and their checks. A plan that is not stale is
 * returned as it is.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, postSchema);
  const res = await refreshPlan({ profile, xrayId: body.xray, actor: { profileId: profile.id, ip: clientIp(req) }, tz: clientTz(req) });
  return Response.json(res, { status: res.status === 'generating' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } });
});
