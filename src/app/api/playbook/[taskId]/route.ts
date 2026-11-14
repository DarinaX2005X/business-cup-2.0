import { z } from 'zod';
import { isLocale } from '@/i18n/config';
import { clientIp, clientTz, readJson, requireProfile, withApi } from '@/server/profile/http';
import { clearEdit, EDIT_MAX_CHARS, saveEdit } from '@/server/playbook';

type Ctx = { params: Promise<{ taskId: string }> };

export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().min(1).max(EDIT_MAX_CHARS + 200),
  locale: z.string().optional(),
});

const taskIdOk = (id: string) => /^[0-9A-Za-z_-]{1,16}$/.test(id);

/** PUT /api/playbook/:taskId { text, locale? } → { card }: saves the person's own version. 400 too_short / too_long, 402, 404. */
export const PUT = withApi(async (req: Request, ctx: Ctx) => {
  const { taskId } = await ctx.params;
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  if (!taskIdOk(taskId)) return Response.json({ error: { code: 'not_found', message: 'Unknown task.' } }, { status: 404 });
  const locale = isLocale(body.locale) ? body.locale : profile.locale;
  const card = await saveEdit({ profile, locale, headerTz: clientTz(req), ip: clientIp(req) }, taskId, body.text);
  return Response.json({ card });
});

/** DELETE /api/playbook/:taskId?locale= → { card }: drops the edit, the card shows practice or the starter again. */
export const DELETE = withApi(async (req: Request, ctx: Ctx) => {
  const { taskId } = await ctx.params;
  const profile = await requireProfile(req);
  if (!taskIdOk(taskId)) return Response.json({ error: { code: 'not_found', message: 'Unknown task.' } }, { status: 404 });
  const q = new URL(req.url).searchParams.get('locale');
  const card = await clearEdit({ profile, locale: isLocale(q) ? q : profile.locale, headerTz: clientTz(req), ip: clientIp(req) }, taskId);
  return Response.json({ card });
});
