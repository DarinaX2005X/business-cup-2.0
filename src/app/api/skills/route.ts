import { z } from 'zod';
import { extractSkills, editSkills, ownXray, skillsResponse } from '@/server/growth';
import { isPro } from '@/server/profile';
import { clientIp, HttpError, readJson, requireProfile, withApi } from '@/server/profile/http';

// One model call with the shared client's retries and failover (up to ~100 s in the worst case).
export const maxDuration = 300;

const xraySchema = z.string().regex(/^[0-9A-Za-z]{12}$/).nullish();

const postSchema = z.object({
  // Larger input is accepted and cut to 20 000 characters, like the résumé reader.
  text: z.string().trim().min(1, 'text: empty').max(200_000, 'text: too long'),
  xray: xraySchema,
});

const patchSchema = z.intersection(
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('confirm'), id: z.string().min(1).max(40) }),
    z.object({ op: z.literal('confirm_all') }),
    z.object({ op: z.literal('remove'), id: z.string().min(1).max(40) }),
    z.object({ op: z.literal('restore'), id: z.string().min(1).max(40) }),
    z.object({ op: z.literal('add'), name: z.string().trim().min(1).max(80), kind: z.enum(['skill', 'knowledge', 'tool']).optional() }),
  ]),
  z.object({ xray: xraySchema }),
);

/**
 * GET /api/skills?xray=<id> → SkillsResponse: the person's skills and, for that map's job, what it relies
 * on and what is worth building next (Pro; Free gets `locked` with the count and the job's needs).
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const xray = xraySchema.safeParse(new URL(req.url).searchParams.get('xray') || null);
  const map = await ownXray(profile, xray.success ? xray.data : null);
  return Response.json(await skillsResponse(profile, map), { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * POST /api/skills { text, xray? } → SkillsResponse: reads skills from a résumé or work description
 * (profile.skills). The text is not stored. Free gets one read; after it 402 pro_required.
 * 422 too_short | not_work, 409 no_xray, 503 ai_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, postSchema);
  // Everyone gets the one read that comes with a new map from a résumé (/start sends it with the map's id,
  // while the profile has no skills yet); reading again by hand is Pro
  if (!isPro(profile) && (profile.skills?.extractedAt || !body.xray)) throw new HttpError(402, 'pro_required', 'Reading your skills again is part of Pro.');
  const res = await extractSkills({ profile, text: body.text, xrayId: body.xray, actor: { profileId: profile.id, ip: clientIp(req) } });
  return Response.json(res, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * PATCH /api/skills { op: confirm|confirm_all|remove|restore|add, id?, name?, kind?, xray? } (Pro)
 * → SkillsResponse & { item }. 402 pro_required, 404 not_found, 400 too_short, 409 limit.
 */
export const PATCH = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { xray, ...patch } = await readJson(req, patchSchema);
  return Response.json(await editSkills(profile, patch, xray), { headers: { 'Cache-Control': 'no-store' } });
});
