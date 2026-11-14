import { siteOrigin } from '@/server/billing';
import { shareProof } from '@/server/progress';
import { clientTz, requireProfile, withApi } from '@/server/profile/http';

/**
 * POST /api/proof/share → { url, slug, pointsAwarded }: the public proof page link, and `proof_shared`
 * (25 points at most once a week). 409 nothing_public until an entry is public.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  // Production links use the site address; local and preview runs link to where they run.
  const origin = process.env.NODE_ENV === 'production' ? siteOrigin(req) : new URL(req.url).origin;
  return Response.json(await shareProof(profile, origin, clientTz(req)));
});
