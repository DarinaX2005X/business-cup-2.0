import { z } from 'zod';
import { dayKey, hashIp } from '@/server/ai/budget';
import { getStore } from '@/server/store';
import { createProfile, deleteProfile, toPublicProfile, updateProfile } from '@/server/profile';
import { clientIp, clientTz, HttpError, readJson, requireProfile, withApi } from '@/server/profile/http';

const localeSchema = z.enum(['en', 'ru', 'kk']);
const CREATE_PER_IP_PER_DAY = 30;
const MAX_HINTS = 200;

const createSchema = z.object({
  locale: localeSchema,
  invitedBy: z.string().max(64).nullish(),
});

const patchSchema = z
  .strictObject({
    locale: localeSchema.optional(),
    salary: z.number().int().min(1_000).max(10_000_000).nullable().optional(),
    sound: z.boolean().optional(),
    tz: z.string().max(64).nullable().optional(),
    /** Added to the stored list (union), so two tabs marking different hints both keep theirs. */
    hintsSeen: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'nothing to change');

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Creates an anonymous profile. The secret is returned once; the server stores only its hash. */
export const POST = withApi(async (req: Request) => {
  const body = await readJson(req, createSchema);
  const key = `rl:create:${hashIp(clientIp(req))}:${dayKey()}`;
  const n = await getStore().incrFloat(key, 1, 2 * 24 * 3600);
  if (n > CREATE_PER_IP_PER_DAY) throw new HttpError(429, 'rate_limited', 'Too many new profiles from this network today.');
  const { profile, secret } = await createProfile({ locale: body.locale, tz: clientTz(req), invitedBy: body.invitedBy });
  return Response.json({ id: profile.id, secret }, { status: 201 });
});

export const GET = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  return Response.json(toPublicProfile(profile), { headers: { 'Cache-Control': 'no-store' } });
});

export const PATCH = withApi(async (req: Request) => {
  const auth = await requireProfile(req);
  const patch = await readJson(req, patchSchema);
  if (patch.tz && !validTz(patch.tz)) throw new HttpError(400, 'invalid_input', 'tz: unknown time zone');
  const { profile } = await updateProfile(auth.id, (p) => {
    if (patch.locale !== undefined) p.locale = patch.locale;
    if (patch.salary !== undefined) p.salary = patch.salary;
    if (patch.sound !== undefined) p.sound = patch.sound;
    if (patch.tz !== undefined) p.tz = patch.tz;
    if (patch.hintsSeen) p.hintsSeen = [...new Set([...p.hintsSeen, ...patch.hintsSeen])].slice(-MAX_HINTS);
  }, { current: auth });
  return Response.json(toPublicProfile(profile));
});

/** Deletes the profile and everything it owns. Idempotent from the client's point of view. */
export const DELETE = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  await deleteProfile(profile.id);
  return Response.json({ ok: true });
});
