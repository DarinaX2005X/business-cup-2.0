import { z } from 'zod';
import type { Profile } from '@/domain/types';
import { authenticate } from '@/server/profile';
import { HttpError, optionalProfile, requireProfile, withApi } from '@/server/profile/http';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { patchXray, viewXray, type Viewer } from '@/server/xray/records';

type Ctx = { params: Promise<{ id: string }> };

const shareSchema = z.object({ taskId: z.string().min(1).max(16), share: z.number().positive().max(100) });
const patchSchema = z.object({
  shares: z.array(shareSchema).min(1).max(40),
  version: z.number().int().positive(),
  /** Only for navigator.sendBeacon, which cannot send headers. */
  auth: z.object({ id: z.string(), secret: z.string() }).nullish(),
});

/** Body as JSON whatever the content type: sendBeacon sends text/plain. */
async function readBody(req: Request) {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    throw new HttpError(400, 'invalid_input', 'Request body is not valid JSON.');
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

async function handlePatch(req: Request, ctx: Ctx, allowBodyAuth: boolean) {
  const { id } = await ctx.params;
  const body = await readBody(req);
  let profile: Profile | null = null;
  if (req.headers.get('x-profile-id')) profile = await requireProfile(req);
  else if (allowBodyAuth && body.auth) profile = await authenticate(body.auth.id, body.auth.secret);
  if (!profile) throw new HttpError(401, 'unauthorized', 'Missing or invalid profile credentials.');
  const xray = await patchXray({ profile, id, shares: body.shares, version: body.version });
  return Response.json(xray, { headers: { 'Cache-Control': 'no-store' } });
}

/** PATCH /api/xray/:id { shares, version } → XrayResult. 401, 403 not owner, 404, 409 { error, xray } on a stale version. */
export const PATCH = withApi((req: Request, ctx: Ctx) => handlePatch(req, ctx, false));

/** POST /api/xray/:id — the same save for navigator.sendBeacon (text/plain JSON, credentials in `auth`). */
export const POST = withApi((req: Request, ctx: Ctx) => handlePatch(req, ctx, true));

/**
 * GET /api/xray/:id → { xray, isOwner }. The owner is recognised by headers or the profile cookie;
 * everyone else gets the map without the owner's id and with the BLS median instead of their pay.
 */
export const GET = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  let viewer: Viewer = await optionalProfile(req).catch(() => null);
  if (!viewer) viewer = await getProfileFromCookies();
  const view = await viewXray(id, viewer);
  if (!view) throw new HttpError(404, 'not_found', 'Week map not found.');
  return Response.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
});
