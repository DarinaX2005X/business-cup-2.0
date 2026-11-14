import { z } from 'zod';
import { acceptInvite } from '@/server/invite';
import { readJson, requireProfile, withApi } from '@/server/profile/http';

const schema = z.object({ ref: z.string().min(1).max(64) });

/**
 * POST /api/invite/accept `{ ref }` (profile headers): links this profile to the colleague whose link was
 * opened. 200 `{ status: 'linked' | 'already_linked' }`; 404 `unknown_invite`; 409 `self_invite`,
 * `too_late` (a week map already exists), `already_invited`.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { ref } = await readJson(req, schema);
  return Response.json(await acceptInvite(profile, ref.trim()));
});
