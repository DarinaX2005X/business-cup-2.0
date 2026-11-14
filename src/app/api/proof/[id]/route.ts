import { z } from 'zod';
import { setProofPublic } from '@/server/progress';
import { readJson, requireProfile, withApi } from '@/server/profile/http';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.strictObject({ public: z.boolean() });

/**
 * PATCH /api/proof/:id { public } → { entry: ProofEntry, publicSlug }. The first public entry gives the
 * profile its public page `/p/<slug>`. 404 when the entry is not yours.
 */
export const PATCH = withApi(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const out = await setProofPublic(profile, id.slice(0, 64), body.public);
  return Response.json(out);
});
