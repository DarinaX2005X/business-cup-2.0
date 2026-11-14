import { INVITE_TERMS, settleInvites } from '@/server/invite';
import { requireProfile, withApi } from '@/server/profile/http';

/**
 * GET /api/invite (profile headers): the invite link and how it went.
 * `{ code, path, joined, mapped, rewarded, terms: { inviterPoints, inviteePoints, max }, pointsAwarded }`.
 * Colleagues who mapped their week since the last look are paid here (once each, 10 at most).
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const s = await settleInvites(profile);
  return Response.json(
    {
      code: s.code,
      path: `/?ref=${s.code}`,
      joined: s.joined,
      mapped: s.mapped,
      rewarded: s.rewarded,
      terms: INVITE_TERMS,
      pointsAwarded: s.pointsAwarded,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
