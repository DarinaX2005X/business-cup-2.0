import { isLocale } from '@/i18n/config';
import { clientIp, clientTz, requireProfile, withApi } from '@/server/profile/http';
import { getPlaybook } from '@/server/playbook';

/** Starter generation (after the response) runs a few parallel model calls. */
export const maxDuration = 90;

/**
 * GET /api/playbook?locale= → PlaybookView: one card per week task AI does or speeds up, with the
 * instruction to copy and the checklist. `starter: 'pending'` while the starter instructions are written
 * (poll every few seconds). 401, 409 no_xray.
 */
export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const q = new URL(req.url).searchParams.get('locale');
  const view = await getPlaybook({ profile, locale: isLocale(q) ? q : profile.locale, headerTz: clientTz(req), ip: clientIp(req) });
  return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
});
