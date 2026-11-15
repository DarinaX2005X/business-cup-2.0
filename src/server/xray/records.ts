import { randomBytes } from 'node:crypto';
import { normalizeShares } from '@/domain/shares';
import { computeXray } from '@/domain/xray';
import type { Locale, OccupationBundle, PointsAward, Profile, WeekShare, XrayResult } from '@/domain/types';
import { emit } from '@/server/events';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { loadBundle } from './data';

/**
 * Week maps (02.1.4): `xray:<id>` holds an XrayResult. The record's `version` always equals the store
 * version, so PATCH can compare-and-set on it: a tab editing an older version gets 409 with the
 * current map instead of overwriting it. Derived numbers are recomputed from the bundle on every write
 * and on every read (practice and salary can change after the map was saved).
 */

export const xrayKey = (id: string) => `xray:${id}`;
const requestKey = (profileId: string, requestId: string) => `xreq:${profileId}:${requestId}`;
const REQUEST_TTL_SEC = 24 * 3600;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const XRAY_ID_RE = /^[0-9A-Za-z]{12}$/;
export const isXrayId = (v: unknown): v is string => typeof v === 'string' && XRAY_ID_RE.test(v);

/** 12 base62 characters (~71 bits): unguessable enough for share links. */
export function newXrayId(): string {
  let out = '';
  while (out.length < 12) {
    for (const b of randomBytes(24)) if (b < 248 && out.length < 12) out += BASE62[b % 62];
  }
  return out;
}

/** What a viewer who does not own the map receives: no owner id, the BLS median instead of the owner's pay. */
export type XrayView = Omit<XrayResult, 'profileId'> & { profileId?: string };

type PracticeSource = Pick<Profile, 'repLog'>;

/**
 * Verified practice for the score: completed reps with a score. Rep scores are read as 0..1;
 * values above 1 are treated as percentages. Stage 03 can import this to stay consistent.
 */
export function practiceOf(profile: PracticeSource): { n: number; avgScore: number } {
  const scores = profile.repLog
    .map((r) => r.score)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 0)
    .map((s) => (s > 1 ? Math.min(1, s / 100) : s));
  if (!scores.length) return { n: 0, avgScore: 0 };
  return { n: scores.length, avgScore: scores.reduce((a, b) => a + b, 0) / scores.length };
}

/** ISO-8601 week of `date` in the profile's time zone (UTC when unknown), e.g. "2026-W46". */
export function isoWeek(date: Date, tz: string | null): string {
  let y: number, m: number, d: number;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    [y, m, d] = [get('year'), get('month'), get('day')];
  } catch {
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  }
  const day = new Date(Date.UTC(y, m - 1, d));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function computeFields(bundle: OccupationBundle, shares: WeekShare[], salary: number | null | undefined, practice: { n: number; avgScore: number }) {
  return computeXray(bundle, shares, { salary: salary ?? null, practice }).result;
}

async function requireBundle(code: string): Promise<OccupationBundle> {
  const bundle = await loadBundle(code);
  if (!bundle) throw new HttpError(400, 'invalid_input', 'occupationCode: unknown occupation');
  return bundle;
}

function cleanShares(shares: WeekShare[], bundle: OccupationBundle): WeekShare[] {
  const clean = normalizeShares(shares, bundle);
  if (!clean.length) throw new HttpError(400, 'invalid_input', 'shares: no valid tasks of this occupation');
  return clean;
}

export async function readXray(id: string): Promise<XrayResult | null> {
  if (!isXrayId(id)) return null;
  const hit = await getStore().get<XrayResult>(xrayKey(id));
  return hit ? { ...hit.value, version: hit.version } : null;
}

// ---------------------------------------------------------------------------------------------
// Create

export interface CreateXrayInput {
  profile: Profile;
  occupationCode: string;
  shares: WeekShare[];
  jobTitle: string;
  inputSource: XrayResult['inputSource'];
  salary?: number | null;
  locale?: Locale;
  /** Client-generated id of this submission: a repeated request returns the same map instead of a second one. */
  requestId?: string | null;
}

export async function createXray(input: CreateXrayInput): Promise<{ xray: XrayResult; awards: PointsAward[]; created: boolean }> {
  const { profile } = input;
  const bundle = await requireBundle(input.occupationCode);
  const shares = cleanShares(input.shares, bundle);
  const store = getStore();
  const id = newXrayId();

  if (input.requestId) {
    const key = requestKey(profile.id, input.requestId);
    try {
      await store.set(key, { id }, { version: 0, ttlSec: REQUEST_TTL_SEC });
    } catch (err) {
      if (!isConflictError(err)) throw err;
      const prev = await store.get<{ id: string }>(key);
      const existing = prev ? await readXray(prev.value.id) : null;
      if (existing && existing.profileId === profile.id) return { xray: existing, awards: [], created: false };
      throw new HttpError(409, 'in_progress', 'This week map is already being saved.');
    }
  }

  const salary = input.salary !== undefined ? input.salary : (profile.salary ?? null);
  const now = new Date().toISOString();
  const computed = computeFields(bundle, shares, salary, practiceOf(profile));
  const xray: XrayResult = {
    ...computed,
    id,
    version: 1,
    profileId: profile.id,
    locale: input.locale ?? profile.locale,
    jobTitle: input.jobTitle,
    inputSource: input.inputSource,
    createdAt: now,
    updatedAt: now,
  };
  await store.set(xrayKey(id), xray, { version: 0 });

  try {
    const week = isoWeek(new Date(now), profile.tz);
    const { awards, profile: updated } = await updateProfile(
      profile.id,
      (p) => {
        p.occupationCode = xray.occupationCode;
        p.jobTitle = xray.jobTitle;
        p.shares = xray.shares;
        p.lastXrayId = id;
        if (!p.xrays.includes(id)) p.xrays.push(id);
        if (input.salary !== undefined) p.salary = input.salary;
        const afterXray = emit(p, { type: 'xray_completed', ref: xray.occupationCode, data: { xrayId: id } });
        return emit(afterXray.profile, { type: 'week_confirmed', ref: week, data: { xrayId: id } });
      },
      { current: profile },
    );
    // a colleague who came by invite and now has a map pays their inviter at once (dynamic import: no cycle)
    if (updated.invitedBy) void import('@/server/invite').then((m) => m.settleInviteFor(updated)).catch(() => undefined);
    return { xray, awards, created: true };
  } catch (err) {
    // Without the profile link nobody can reach or delete the map: remove it and let the client retry.
    await store.del(xrayKey(id)).catch(() => undefined);
    if (input.requestId) await store.del(requestKey(profile.id, input.requestId)).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Patch

export async function patchXray(input: { profile: Profile; id: string; shares: WeekShare[]; version: number }): Promise<XrayResult> {
  const { profile, id } = input;
  const current = await readXray(id);
  if (!current) throw new HttpError(404, 'not_found', 'Week map not found.');
  if (current.profileId !== profile.id) throw new HttpError(403, 'forbidden', 'Only the owner can change this week map.');
  if (current.version !== input.version) {
    throw new HttpError(409, 'conflict', 'The week map changed in another tab.', { xray: current });
  }
  const bundle = await requireBundle(current.occupationCode);
  const shares = cleanShares(input.shares, bundle);
  const next: XrayResult = {
    ...current,
    ...computeFields(bundle, shares, profile.salary, practiceOf(profile)),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    next.version = await getStore().set(xrayKey(id), next, { version: current.version });
  } catch (err) {
    if (!isConflictError(err)) throw err;
    throw new HttpError(409, 'conflict', 'The week map changed in another tab.', { xray: await readXray(id) });
  }
  if (profile.lastXrayId === id) {
    // The latest map is the week reps are drawn from; keep the profile copy in step (no events).
    await updateProfile(profile.id, (p) => {
      if (p.lastXrayId === id) p.shares = next.shares;
    });
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Read for a viewer

export type Viewer = Pick<Profile, 'id' | 'salary' | 'repLog'> | null;

/**
 * The map as this viewer may see it, recomputed with current data. The owner gets their own salary
 * and practice; anyone else gets the BLS median, the practice stored with the map and no profile id.
 */
export async function viewXray(id: string, viewer: Viewer): Promise<{ xray: XrayView; isOwner: boolean } | null> {
  const stored = await readXray(id);
  if (!stored) return null;
  const bundle = await loadBundle(stored.occupationCode);
  const isOwner = viewer !== null && viewer.id === stored.profileId;
  if (!bundle) {
    // Data rebuilt without this occupation: show what was saved, minus private fields.
    return { xray: isOwner ? stored : toGuest(stored), isOwner };
  }
  if (isOwner) {
    return { xray: { ...stored, ...computeFields(bundle, stored.shares, viewer.salary, practiceOf(viewer)) }, isOwner };
  }
  return { xray: toGuest({ ...stored, ...computeFields(bundle, stored.shares, null, stored.practice) }), isOwner };
}

function toGuest(x: XrayResult): XrayView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { profileId, ...rest } = x;
  if (x.salary.source === 'user') return { ...rest, salary: { annual: null, source: 'none' }, payAtStake: null };
  return rest;
}
