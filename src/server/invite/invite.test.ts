import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { useTempStore } from '../../../tests/platform/helpers';
import { acceptInvite, ensureInviteCode, inviteCode, resolveInviter, settleInviteFor, settleInvites } from './index';

let cleanup: () => void;
beforeEach(() => ({ cleanup } = useTempStore()));
afterEach(() => cleanup());

const status = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as HttpError | null)?.code;

describe('invites', () => {
  it('links a new colleague, refuses self and pays the inviter once the colleague has a map and a finished rep', async () => {
    const { profile: a } = await createProfile({ locale: 'en' });
    const code = await ensureInviteCode(a.id);
    expect(code).toBe(inviteCode(a.id));
    expect(code).not.toContain(a.id);
    expect(await resolveInviter(code)).toBe(a.id);

    expect(await status(acceptInvite(a, code))).toBe('self_invite');

    const { profile: b } = await createProfile({ locale: 'en' });
    expect(await acceptInvite(b, code)).toEqual({ status: 'linked' });
    let b2 = (await getProfile(b.id))!;
    expect(b2.invitedBy).toBe(a.id);

    // before the map: nothing to pay
    expect((await settleInvites((await getProfile(a.id))!)).pointsAwarded).toEqual([]);

    // the colleague maps their week: not yet (empty profiles must not farm points)
    ({ profile: b2 } = await updateProfile(b.id, (p) => void p.xrays.push('AAAAAAAAAAAA')));
    expect(await settleInviteFor(b2)).toEqual([]);
    expect((await settleInvites((await getProfile(a.id))!)).pointsAwarded).toEqual([]);
    // ... and finishes a first rep
    ({ profile: b2 } = await updateProfile(b.id, (p) => void p.repLog.push({ id: 'r1', taskId: 't', type: 'slip', kind: 'trial', day: '2026-11-15', score: 0.5 })));
    const first = await settleInviteFor(b2);
    expect(first.map((x) => x.points)).toEqual([300]);
    expect(await settleInviteFor(b2)).toEqual([]);
    const summary = await settleInvites((await getProfile(a.id))!);
    expect(summary).toMatchObject({ joined: 1, mapped: 1, rewarded: 1, pointsAwarded: [] });
    expect((await getProfile(a.id))!.points.balance).toBe(300);

    // a profile that already has a map cannot be linked afterwards
    const { profile: c } = await createProfile({ locale: 'en' });
    const { profile: c2 } = await updateProfile(c.id, (p) => void p.xrays.push('BBBBBBBBBBBB'));
    expect(await status(acceptInvite(c2, code))).toBe('too_late');
  });
});
