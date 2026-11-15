import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATCH as profilePATCH } from '@/app/api/profile/route';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { useTempStore } from './helpers';

let cleanup: () => void;
beforeEach(() => ({ cleanup } = useTempStore()));
afterEach(() => cleanup());

const patch = (id: string, secret: string, body: unknown) =>
  profilePATCH(new Request('http://localhost/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-profile-id': id, 'x-profile-secret': secret }, body: JSON.stringify(body) }));

describe('time zone changes', () => {
  it('the first zone is set freely; after that the day boundary moves at most once a day', async () => {
    const { profile, secret } = await createProfile({ locale: 'en', tz: null });
    await patch(profile.id, secret, { tz: 'America/Chicago' });
    expect((await getProfile(profile.id))!.tz).toBe('America/Chicago');
    await patch(profile.id, secret, { tz: 'Asia/Tokyo' });
    expect((await getProfile(profile.id))!.tz).toBe('Asia/Tokyo');
    // a second move the same day is ignored
    await patch(profile.id, secret, { tz: 'Pacific/Honolulu' });
    expect((await getProfile(profile.id))!.tz).toBe('Asia/Tokyo');
    // a day later it may move again
    await updateProfile(profile.id, (p) => {
      p.tzChangedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    });
    await patch(profile.id, secret, { tz: 'Pacific/Honolulu' });
    expect((await getProfile(profile.id))!.tz).toBe('Pacific/Honolulu');
  });
});
