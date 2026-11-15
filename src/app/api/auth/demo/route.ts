import { z } from 'zod';
import { JURY_PERSONAS, openDemoAccount, takeDemoOpen } from '@/server/demo';
import { clientIp, readJson, withApi } from '@/server/profile/http';

// The first click per persona builds its template with live model calls; later clicks copy it at once.
export const maxDuration = 300;

const bodySchema = z.object({ persona: z.enum(JURY_PERSONAS) });

/**
 * POST /api/auth/demo { persona: 'nurse' | 'software' | 'accountant' } (no profile needed) →
 * 201 { id, secret, email, xrayId }: a private copy of that persona's demo account for this visitor, with
 * its own week map (built from the sample résumé through the real pipeline), skills, 90-day plan and Max
 * until Nov 30. 429 rate_limited (60 copies an hour per IP), 503 ai_unavailable / demo_unavailable (try again).
 */
export const POST = withApi(async (req: Request) => {
  const { persona } = await readJson(req, bodySchema);
  await takeDemoOpen(clientIp(req));
  const res = await openDemoAccount(persona, { ip: clientIp(req) });
  return Response.json({ id: res.id, secret: res.secret, email: res.email, xrayId: res.xrayId }, { status: res.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
});
