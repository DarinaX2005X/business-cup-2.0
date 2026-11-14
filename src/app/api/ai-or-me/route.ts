import { z } from 'zod';
import { localDay } from '@/domain/reps';
import { clientTz, HttpError, readJson, requireProfile, withApi } from '@/server/profile/http';
import { aiOrMeFor, submitAiOrMe, weekOf } from '@/server/reps';

async function context(req: Request) {
  const profile = await requireProfile(req);
  const week = await weekOf(profile);
  if (!week) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  return { profile, week, day: localDay(new Date(), profile.tz ?? clientTz(req)) };
}

/** GET /api/ai-or-me (x-tz) → AiOrMeRound of the day (+ completed when already played). 409 no_xray. */
export const GET = withApi(async (req: Request) => {
  const { profile, week, day } = await context(req);
  return Response.json(await aiOrMeFor(profile, week, day), { headers: { 'Cache-Control': 'no-store' } });
});

const bodySchema = z.object({
  roundId: z.string().min(1).max(64),
  answers: z.array(z.enum(['ai', 'human']).nullable()).max(5),
});

/** POST /api/ai-or-me { roundId, answers } → { correct, right, total, pointsAwarded }. 409 already_played / stale_round. */
export const POST = withApi(async (req: Request) => {
  const { profile, week, day } = await context(req);
  const body = await readJson(req, bodySchema);
  return Response.json(await submitAiOrMe(profile, week, day, body));
});
