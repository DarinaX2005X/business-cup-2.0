import { createHash } from 'node:crypto';
import { POINT_RULES } from '@/domain/points';
import type { PointsAward, Profile } from '@/domain/types';
import { emit } from '@/server/events';
import { getProfile, isProfileId, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';

/**
 * Invites (05.2.3). A profile's invite link is `/?ref=<code>`, where the code is a one-way hash of the
 * profile id: the link never reveals the id, and the same profile always gets the same code.
 *
 * - `invite:<code>` → `{ profileId }`: written when the owner first asks for the link, read when someone
 *   arrives with it.
 * - `invitees:<inviterId>` → `{ ids }`: profiles that joined through the link (at most INVITEES_MAX kept).
 * - A colleague is linked to the inviter through `Profile.invitedBy`, either at profile creation
 *   (`resolveInviter` from `createProfile`) or right after it (`acceptInvite`, only before their first map).
 * - When the colleague's first week map exists, the inviter gets `invite_completed` (300 points, at most 10
 *   colleagues, ref = the colleague's hashed id so the inviter never sees it) and the colleague gets
 *   `invited_bonus` (100) with that map (rule in src/domain/points.ts). `settleInviteFor` does it right after
 *   the map is saved; `settleInvites` catches up whenever the inviter opens their invite panel.
 */

export const INVITE_CODE_RE = /^[0-9A-Za-z]{10}$/;
export const isInviteCode = (v: unknown): v is string => typeof v === 'string' && INVITE_CODE_RE.test(v);

/** How many joined colleagues a profile keeps on record; only 10 can earn points. */
export const INVITEES_MAX = 50;

const rule = (id: string) => POINT_RULES.find((r) => r.id === id)!;
/** Points the inviter gets per colleague, the colleague's welcome bonus and the cap, from the points rules. */
export const INVITE_TERMS = {
  inviterPoints: rule('invite_completed').max,
  inviteePoints: rule('invited_bonus').max,
  max: (rule('invite_completed').limit as { count: number }).count,
} as const;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function hash10(input: string): string {
  const bytes = createHash('sha256').update(input).digest();
  let out = '';
  for (let i = 0; out.length < 10; i++) out += BASE62[bytes[i] % 62];
  return out;
}

/** The profile's invite code: stable, 10 base62 characters, not reversible to the id. */
export const inviteCode = (profileId: string) => hash10(`irr:invite:v1:${profileId}`);
/** What the inviter's points journal records for a colleague (not their profile id). */
export const inviteeRef = (inviteeId: string) => hash10(`irr:invitee:v1:${inviteeId}`);

export const inviteKey = (code: string) => `invite:${code}`;
export const inviteesKey = (profileId: string) => `invitees:${profileId}`;

/** Keys to remove with the profile (for `profileOwnedKeys`). */
export const inviteKeysOf = (profileId: string) => [inviteKey(inviteCode(profileId)), inviteesKey(profileId)];

/** Makes sure the code resolves to this profile and returns it. */
export async function ensureInviteCode(profileId: string): Promise<string> {
  const code = inviteCode(profileId);
  const store = getStore();
  const hit = await store.get<{ profileId: string }>(inviteKey(code));
  if (hit?.value.profileId === profileId) return code;
  try {
    await store.set(inviteKey(code), { profileId }, hit ? { version: hit.version } : { version: 0 });
  } catch (err) {
    if (!isConflictError(err)) throw err; // another request wrote the same mapping
  }
  return code;
}

/**
 * The inviter behind a `ref`: an invite code, or (older clients) a raw profile id. Null when unknown or when
 * the inviter's profile no longer exists.
 */
export async function resolveInviter(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  let id: string | null = null;
  if (isInviteCode(ref)) id = (await getStore().get<{ profileId: string }>(inviteKey(ref)))?.value.profileId ?? null;
  else if (isProfileId(ref)) id = ref;
  if (!id || !isProfileId(id)) return null;
  return (await getProfile(id)) ? id : null;
}

/** Adds a colleague to the inviter's list (idempotent, bounded). */
export async function registerInvitee(inviterId: string, inviteeId: string): Promise<void> {
  if (inviterId === inviteeId) return;
  const store = getStore();
  for (let attempt = 0; attempt < 4; attempt++) {
    const hit = await store.get<{ ids: string[] }>(inviteesKey(inviterId));
    const ids = hit?.value.ids ?? [];
    if (ids.includes(inviteeId) || ids.length >= INVITEES_MAX) return;
    try {
      await store.set(inviteesKey(inviterId), { ids: [...ids, inviteeId] }, { version: hit?.version ?? 0 });
      return;
    } catch (err) {
      if (!isConflictError(err)) throw err;
    }
  }
}

/** A colleague counts once their first week map exists. */
const hasMap = (p: Pick<Profile, 'xrays' | 'lastXrayId'>) => p.xrays.length > 0 || Boolean(p.lastXrayId);

export type AcceptResult = { status: 'linked' | 'already_linked' };

/**
 * Links a profile to the inviter behind `ref`. Refused for one's own link (`self_invite`), for a profile
 * that already maps its week (`too_late`: the bonus comes with the first map) and for a profile linked to
 * someone else (`already_invited`). The same link twice is fine.
 */
export async function acceptInvite(profile: Profile, ref: string): Promise<AcceptResult> {
  if (isInviteCode(ref) && ref === inviteCode(profile.id)) throw new HttpError(409, 'self_invite', 'This is your own invite link.');
  const inviterId = await resolveInviter(ref);
  if (!inviterId) throw new HttpError(404, 'unknown_invite', 'This invite link is not valid any more.');
  if (inviterId === profile.id) throw new HttpError(409, 'self_invite', 'This is your own invite link.');
  if (profile.invitedBy) {
    if (profile.invitedBy !== inviterId) throw new HttpError(409, 'already_invited', 'This profile already came with another invite.');
    await registerInvitee(inviterId, profile.id);
    return { status: 'already_linked' };
  }
  if (hasMap(profile)) throw new HttpError(409, 'too_late', 'Invites count only before the first week map.');
  const { profile: next } = await updateProfile(
    profile.id,
    (p) => {
      if (!p.invitedBy && !hasMap(p)) p.invitedBy = inviterId;
    },
    { current: profile },
  );
  if (next.invitedBy !== inviterId) {
    throw new HttpError(409, next.invitedBy ? 'already_invited' : 'too_late', 'The profile changed while the invite was being accepted.');
  }
  await registerInvitee(inviterId, profile.id);
  return { status: 'linked' };
}

const credited = (inviter: Pick<Profile, 'points'>, inviteeId: string) =>
  inviter.points.events.some((e) => e.type === 'invite_completed' && e.ref === inviteeRef(inviteeId));

/**
 * Hook for the end of the colleague's first map (`createXray`): awards the inviter right away.
 * Returns the inviter's awards (not shown to the colleague). Never throws: the map is already saved.
 */
export async function settleInviteFor(invitee: Pick<Profile, 'id' | 'invitedBy' | 'xrays' | 'lastXrayId'>): Promise<PointsAward[]> {
  try {
    if (!invitee.invitedBy || invitee.invitedBy === invitee.id || !hasMap(invitee)) return [];
    const inviter = await getProfile(invitee.invitedBy);
    if (!inviter || credited(inviter, invitee.id)) return [];
    await registerInvitee(inviter.id, invitee.id);
    const { awards } = await updateProfile(inviter.id, (p) => emit(p, { type: 'invite_completed', ref: inviteeRef(invitee.id) }), { current: inviter });
    return awards;
  } catch (err) {
    console.error('[invite] settle after map failed', err);
    return [];
  }
}

export interface InviteSummary {
  code: string;
  /** Colleagues who opened the link and got a profile. */
  joined: number;
  /** Of them, those who mapped their week. */
  mapped: number;
  /** Colleagues the inviter has been paid for (at most `INVITE_TERMS.max`). */
  rewarded: number;
  pointsAwarded: PointsAward[];
}

/**
 * The inviter's view: makes sure the code resolves, pays for colleagues who mapped their week since the
 * last look (the points rules keep it to once per colleague and 10 in all) and counts the rest.
 */
export async function settleInvites(inviter: Profile): Promise<InviteSummary> {
  const code = await ensureInviteCode(inviter.id);
  const ids = (await getStore().get<{ ids: string[] }>(inviteesKey(inviter.id)))?.value.ids ?? [];
  const invitees = (await Promise.all(ids.map((id) => getProfile(id).catch(() => null)))).filter(
    (p): p is Profile => p !== null && p.invitedBy === inviter.id,
  );
  const mapped = invitees.filter(hasMap);
  const due = mapped.filter((p) => !credited(inviter, p.id));
  let current = inviter;
  let pointsAwarded: PointsAward[] = [];
  if (due.length) {
    const res = await updateProfile(
      inviter.id,
      (p) => {
        let next = p;
        for (const c of due) next = emit(next, { type: 'invite_completed', ref: inviteeRef(c.id) }).profile;
        return next;
      },
      { current: inviter },
    );
    current = res.profile;
    pointsAwarded = res.awards;
  }
  const rewarded = current.points.events.filter((e) => e.type === 'invite_completed').length;
  return { code, joined: invitees.length, mapped: mapped.length, rewarded, pointsAwarded };
}
