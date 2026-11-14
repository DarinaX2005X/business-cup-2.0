import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfile, getProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { createXray, isoWeek, patchXray, practiceOf, readXray, viewXray } from '@/server/xray/records';
import { typicalWeek } from '@/server/xray/week';
import { loadBundle } from '@/server/xray/data';
import type { Profile } from '@/domain/types';
import { useTempStore } from '../platform/helpers';

let cleanup: () => void;
beforeEach(() => {
  ({ cleanup } = useTempStore());
});
afterEach(() => cleanup());

async function newProfile(salary?: number): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  if (salary === undefined) return profile;
  return { ...profile, salary };
}

async function nurseWeek() {
  const bundle = (await loadBundle('29-1141.00'))!;
  return typicalWeek(bundle).shares;
}

describe('week map records', () => {
  it('create saves version 1, links it to the profile and recomputes from the bundle', async () => {
    const profile = await newProfile();
    const shares = await nurseWeek();
    const { xray, created } = await createXray({ profile, occupationCode: '29-1141.00', shares, jobTitle: 'Med-surg nurse', inputSource: 'resume', salary: 88000 });
    expect(created).toBe(true);
    expect(xray.version).toBe(1);
    expect(xray.salary).toEqual({ annual: 88000, source: 'user' });
    expect(xray.shares.reduce((a, s) => a + s.share, 0)).toBe(100);
    const p = (await getProfile(profile.id))!;
    expect(p).toMatchObject({ occupationCode: '29-1141.00', jobTitle: 'Med-surg nurse', lastXrayId: xray.id, salary: 88000 });
    expect(p.xrays).toEqual([xray.id]);
    expect(p.shares).toEqual(xray.shares);
  });

  it('a repeated requestId returns the same map instead of a second one', async () => {
    const profile = await newProfile();
    const shares = await nurseWeek();
    const a = await createXray({ profile, occupationCode: '29-1141.00', shares, jobTitle: 'Nurse', inputSource: 'title', requestId: 'req-12345678' });
    const b = await createXray({ profile, occupationCode: '29-1141.00', shares, jobTitle: 'Nurse', inputSource: 'title', requestId: 'req-12345678' });
    expect(b.xray.id).toBe(a.xray.id);
    expect(b.created).toBe(false);
    expect((await getProfile(profile.id))!.xrays).toHaveLength(1);
  });

  it('rejects an unknown occupation and shares with no valid task', async () => {
    const profile = await newProfile();
    await expect(createXray({ profile, occupationCode: '99-9999.00', shares: [{ taskId: '1', share: 100 }], jobTitle: 'x', inputSource: 'title' })).rejects.toMatchObject({ status: 400 });
    await expect(createXray({ profile, occupationCode: '29-1141.00', shares: [{ taskId: 'nope', share: 100 }], jobTitle: 'x', inputSource: 'title' })).rejects.toMatchObject({ status: 400 });
  });

  it('patch: owner only, version checked, same id, profile week kept in step', async () => {
    const owner = await newProfile();
    const shares = await nurseWeek();
    const { xray } = await createXray({ profile: owner, occupationCode: '29-1141.00', shares, jobTitle: 'Nurse', inputSource: 'title' });
    const fresh = (await getProfile(owner.id))!;

    const edited = shares.map((s, i) => (i === 0 ? { ...s, share: s.share + 20 } : s));
    const v2 = await patchXray({ profile: fresh, id: xray.id, shares: edited, version: 1 });
    expect(v2.id).toBe(xray.id);
    expect(v2.version).toBe(2);
    expect(v2.shares[0].share).toBeGreaterThan(xray.shares[0].share);
    expect((await readXray(xray.id))!.version).toBe(2);
    expect((await getProfile(owner.id))!.shares).toEqual(v2.shares);

    // a tab still on version 1
    const stale = await patchXray({ profile: fresh, id: xray.id, shares, version: 1 }).catch((e) => e);
    expect(stale).toBeInstanceOf(HttpError);
    expect(stale).toMatchObject({ status: 409, code: 'conflict' });
    expect(stale.extra.xray.version).toBe(2);

    const stranger = await newProfile();
    await expect(patchXray({ profile: stranger, id: xray.id, shares, version: 2 })).rejects.toMatchObject({ status: 403 });
    await expect(patchXray({ profile: fresh, id: 'AAAAAAAAAAAA', shares, version: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it('guest view: no owner id, BLS median instead of the owner salary; owner sees their own', async () => {
    const owner = await newProfile();
    const { xray } = await createXray({ profile: owner, occupationCode: '29-1141.00', shares: await nurseWeek(), jobTitle: 'Nurse', inputSource: 'title', salary: 123456 });
    const ownerNow = (await getProfile(owner.id))!;

    const asOwner = (await viewXray(xray.id, ownerNow))!;
    expect(asOwner.isOwner).toBe(true);
    expect(asOwner.xray.profileId).toBe(owner.id);
    expect(asOwner.xray.salary).toEqual({ annual: 123456, source: 'user' });

    const asGuest = (await viewXray(xray.id, null))!;
    expect(asGuest.isOwner).toBe(false);
    expect('profileId' in asGuest.xray).toBe(false);
    expect(asGuest.xray.salary).toEqual({ annual: 97550, source: 'bls_median' });
    expect(asGuest.xray.payAtStake).not.toBe(asOwner.xray.payAtStake);
    expect(asGuest.xray.score).toBe(asOwner.xray.score);

    expect(await viewXray('nope', null)).toBeNull();
  });

  it('practice and ISO week helpers', () => {
    expect(practiceOf({ repLog: [] })).toEqual({ n: 0, avgScore: 0 });
    expect(practiceOf({ repLog: [{ id: 'a', taskId: 't', type: 'slip', kind: 'daily', day: 'd', score: 0.5 }, { id: 'b', taskId: 't', type: 'slip', kind: 'daily', day: 'd', score: 100 }, { id: 'c', taskId: 't', type: 'slip', kind: 'daily', day: 'd' }] })).toEqual({ n: 2, avgScore: 0.75 });
    expect(isoWeek(new Date('2026-11-14T12:00:00Z'), 'UTC')).toBe('2026-W46');
    expect(isoWeek(new Date('2027-01-01T03:00:00Z'), 'UTC')).toBe('2026-W53');
    // Sunday evening in Chicago is still the previous ISO week while it is Monday in UTC
    expect(isoWeek(new Date('2026-11-16T03:00:00Z'), 'America/Chicago')).toBe('2026-W46');
    expect(isoWeek(new Date('2026-11-16T03:00:00Z'), null)).toBe('2026-W47');
  });
});
