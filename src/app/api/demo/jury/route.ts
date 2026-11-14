import { z } from 'zod';
import { JURY_PERSONAS, openJuryAccount } from '@/server/demo';
import { clientIp, readJson, requireProfile, withApi } from '@/server/profile/http';

// Three model calls in a row (résumé, occupation, week), each with its own timeout and fallback model.
export const maxDuration = 120;

const bodySchema = z.object({ persona: z.enum(JURY_PERSONAS) });

/**
 * POST /api/demo/jury { persona: 'nurse' | 'software' | 'accountant' } (profile required: call
 * useProfile().ensure() first) → 201 { xrayId, plan } for a new account, 200 with the same map on a repeat.
 * Builds the week map from that sample résumé with the live pipeline, unlocks Coach (Business Cup offer)
 * and marks the profile `demo: true`. 401, 409 in_progress (a parallel click), 429 rate_limited,
 * 503 ai_unavailable (both models failed: nothing was saved, try again).
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { persona } = await readJson(req, bodySchema);
  const res = await openJuryAccount(profile, persona, { profileId: profile.id, ip: clientIp(req) });
  return Response.json({ xrayId: res.xrayId, plan: res.plan }, { status: res.created ? 201 : 200 });
});
