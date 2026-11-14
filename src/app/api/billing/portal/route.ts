import { z } from 'zod';
import { createPortal, siteOrigin } from '@/server/billing';
import { readOptionalJson } from '@/server/billing/body';
import { requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({
  /** Where the portal's return link goes: a path on this site only. */
  returnPath: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[A-Za-z0-9/_?=&.-]*$/, 'a path on this site')
    .default('/pricing?portal=1'),
});

/**
 * POST /api/billing/portal { returnPath? } → { url } of the Stripe Billing Portal (cancel, change card,
 * invoices). After the return, GET /api/billing/plan?sync=1 reads the new state. 401, 404 no_subscription.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const { returnPath } = await readOptionalJson(req, bodySchema);
  return Response.json(await createPortal(profile, siteOrigin(req), returnPath));
});
