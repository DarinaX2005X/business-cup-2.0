import { z } from 'zod';
import { JURY_PERSONAS, openDemoAccount } from '@/server/demo';
import { clientIp, readJson, withApi } from '@/server/profile/http';

// The first click per persona builds the account with three live model calls; later clicks are instant.
export const maxDuration = 120;

const bodySchema = z.object({ persona: z.enum(JURY_PERSONAS) });

/**
 * POST /api/auth/demo { persona: 'nurse' | 'software' | 'accountant' } (no profile needed) →
 * 200 { id, secret, email, xrayId } (201 when this request built the account): the shared demo account of that
 * persona, `demo-<persona>@irreplaceable.demo`, with a new device secret. It has a real week map from the
 * sample résumé and Max until Nov 30. 429 rate_limited, 503 ai_unavailable / demo_unavailable (try again).
 */
export const POST = withApi(async (req: Request) => {
  const { persona } = await readJson(req, bodySchema);
  const res = await openDemoAccount(persona, { ip: clientIp(req) });
  return Response.json({ id: res.id, secret: res.secret, email: res.email, xrayId: res.xrayId }, { status: res.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
});
