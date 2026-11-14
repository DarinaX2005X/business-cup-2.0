import { z } from 'zod';
import { isLocale } from '@/i18n/config';
import { clientIp, clientTz, optionalProfile, readJson, requireProfile, withApi } from '@/server/profile/http';
import { runSecondLook, SECOND_LOOK_MAX_CHARS, secondLookState } from '@/server/playbook';

export const maxDuration = 60;

/**
 * GET /api/second-look?locale= → SecondLookState: plan, free runs left and the week's tasks for the
 * picker. Works without a profile (a first visit), then it has no tasks.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await optionalProfile(req);
  const q = new URL(req.url).searchParams.get('locale');
  const state = await secondLookState(profile, isLocale(q) ? q : (profile?.locale ?? 'en'));
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
});

const bodySchema = z.object({
  // a little room for line endings and spaces the normalisation removes
  text: z.string().min(1).max(SECOND_LOOK_MAX_CHARS + 400),
  taskId: z.string().max(16).nullable().optional(),
  locale: z.string().optional(),
});

/**
 * POST /api/second-look { text, taskId?, locale? } → { document, marks, freeLeft, pointsAwarded }.
 * The text is read once and not stored, cached or logged. 400 text_too_short / text_too_long,
 * 402 pro_required (the free one is used), 429, 503 ai_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const locale = isLocale(body.locale) ? body.locale : profile.locale;
  const result = await runSecondLook({ profile, headerTz: clientTz(req), ip: clientIp(req) }, { text: body.text, taskId: body.taskId ?? null, locale });
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
