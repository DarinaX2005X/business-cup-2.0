import { after } from 'next/server';
import { clientIp, clientTz, requireProfile, withApi } from '@/server/profile/http';
import { startTrial } from '@/server/reps';

// A trial without a bank rep is generated live and may continue in after().
export const maxDuration = 120;

/**
 * POST /api/reps/trial → { rep: RepView } | 202 { status: 'generating', repId }. Idempotent: the same rep
 * until it is completed, then 409 trial_used. 409 no_xray without a week map.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const result = await startTrial({ profile, headerTz: clientTz(req), ip: clientIp(req), defer: (job) => after(() => job) });
  return Response.json(result, { status: 'rep' in result ? 200 : 202 });
});
