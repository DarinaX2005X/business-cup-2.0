'use server';

import type { PointsAward } from '@/domain/types';
import { emit } from '@/server/events';
import { authenticate, updateProfile } from '@/server/profile';
import { isXrayId, readXray } from '@/server/xray/records';

/**
 * Point events of this package (05.2), as server actions. Like every write in the product they
 * authenticate with the profile id and secret the browser holds (passed in, never read from the cookie);
 * Next also checks the request's Origin for actions. Awards follow the rules in src/domain/points.ts.
 */

interface Creds {
  id: string;
  secret: string;
}

type Result = { ok: true; pointsAwarded: PointsAward[] } | { ok: false; error: 'unauthorized' | 'not_found' };

/** `pivot_explored`: the first time the person opens the moves from their own map (15 points, once). */
export async function pivotExplored(creds: Creds, xrayId: string): Promise<Result> {
  const profile = await authenticate(creds?.id, creds?.secret);
  if (!profile) return { ok: false, error: 'unauthorized' };
  if (!isXrayId(xrayId) || !profile.xrays.includes(xrayId)) return { ok: false, error: 'not_found' };
  if (profile.points.events.some((e) => e.type === 'pivot_explored')) return { ok: true, pointsAwarded: [] };
  const { awards } = await updateProfile(profile.id, (p) => emit(p, { type: 'pivot_explored', ref: xrayId }), { current: profile });
  return { ok: true, pointsAwarded: awards };
}

/** `proof_shared`: the owner shared their week map (link, LinkedIn or image); 25 points at most once a week. */
export async function weekMapShared(creds: Creds, xrayId: string): Promise<Result> {
  const profile = await authenticate(creds?.id, creds?.secret);
  if (!profile) return { ok: false, error: 'unauthorized' };
  if (!isXrayId(xrayId)) return { ok: false, error: 'not_found' };
  const xray = await readXray(xrayId);
  if (!xray || xray.profileId !== profile.id) return { ok: false, error: 'not_found' };
  const { awards } = await updateProfile(profile.id, (p) => emit(p, { type: 'proof_shared', ref: `map:${xrayId}`, data: { xrayId } }), { current: profile });
  return { ok: true, pointsAwarded: awards };
}
