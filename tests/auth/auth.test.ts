import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { POST as cupPOST } from '@/app/api/billing/cup/route';
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route';
import { DEVICE_CAP, hashPassword, login, logout, normalizeEmail, PER_EMAIL, signup, verifyPassword, withDevice } from '@/server/auth';
import { setStripeForTests } from '@/server/billing';
import { authenticate, createProfile, deleteProfile, emailIndexKey, getProfile, toPublicProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { useTempStore } from '../platform/helpers';
import { createStripeStub } from '../billing/stripe-stub';

const IP = '203.0.113.7';
let cleanup: () => void;
beforeEach(() => {
  ({ cleanup } = useTempStore());
  setStripeForTests(createStripeStub().stripe);
});
afterEach(() => {
  setStripeForTests(null);
  cleanup();
});

async function expectHttp(p: Promise<unknown>, status: number, code: string): Promise<HttpError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(HttpError);
  expect([(e as HttpError).status, (e as HttpError).code]).toEqual([status, code]);
  return e as HttpError;
}

const post = (route: (r: Request) => Promise<Response>, path: string, headers: Record<string, string>, body?: unknown) =>
  route(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));

describe('passwords and emails', () => {
  it('scrypt with a per-user salt; only the right password matches', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horsE', a)).toBe(false);
    expect(await verifyPassword('correct horse', 'none')).toBe(false);
    expect(await verifyPassword('correct horse', undefined)).toBe(false);
  });

  it('emails are trimmed, lowercased and checked', () => {
    expect(normalizeEmail('  Dana.W@Example.COM ')).toBe('dana.w@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it('device list keeps the newest, at most the cap', () => {
    const hashes = Array.from({ length: 12 }, (_, i) => String(i).padStart(64, '0'));
    let p = { secretHash: hashes[0] } as { secretHash: string; secretHashes?: string[] };
    for (const h of hashes.slice(1)) p = { ...p, secretHashes: withDevice(p, h, DEVICE_CAP) };
    expect(p.secretHashes).toHaveLength(DEVICE_CAP);
    expect(p.secretHashes![0]).toBe(hashes[2]);
    expect(p.secretHashes!.at(-1)).toBe(hashes[11]);
  });
});

describe('accounts', () => {
  it('sign-up keeps the guest map; log in elsewhere opens the same profile; log out revokes only that device', async () => {
    const { profile, secret: guestSecret } = await createProfile({ locale: 'en' });
    const { xray } = await createXray({ profile, occupationCode: '29-1141.00', shares: typicalWeek((await loadBundle('29-1141.00'))!).shares, jobTitle: 'RN', inputSource: 'title' });
    const headers = { 'x-profile-id': profile.id, 'x-profile-secret': guestSecret };

    const up = await post(signupPOST, '/api/auth/signup', headers, { email: ' Dana@Example.com ', password: 'night shift 7' });
    expect(up.status).toBe(201);
    expect(await up.json()).toEqual({ email: 'dana@example.com' });
    const stored = (await getProfile(profile.id))!;
    expect(stored.account).toMatchObject({ email: 'dana@example.com' });
    expect(stored.lastXrayId).toBe(xray.id);
    expect((await getStore().get<{ profileId: string }>(emailIndexKey('dana@example.com')))?.value.profileId).toBe(profile.id);

    // the public profile shows the email and nothing secret
    const pub = toPublicProfile(stored) as Record<string, unknown>;
    expect(pub.account).toEqual({ email: 'dana@example.com' });
    expect(JSON.stringify(pub)).not.toMatch(/scrypt|secretHash/);
    expect(toPublicProfile((await createProfile({ locale: 'en' })).profile).account).toBeNull();

    const inRes = await post(loginPOST, '/api/auth/login', {}, { email: 'DANA@example.com', password: 'night shift 7' });
    expect(inRes.status).toBe(200);
    const other = (await inRes.json()) as { id: string; secret: string; email: string };
    expect(other).toMatchObject({ id: profile.id, email: 'dana@example.com' });
    expect(other.secret).not.toBe(guestSecret);
    expect((await authenticate(profile.id, other.secret))?.lastXrayId).toBe(xray.id);
    expect(await authenticate(profile.id, guestSecret)).not.toBeNull();

    const out = await post(logoutPOST, '/api/auth/logout', { 'x-profile-id': profile.id, 'x-profile-secret': other.secret });
    expect(out.status).toBe(200);
    expect(await authenticate(profile.id, other.secret)).toBeNull(); // revoked
    expect(await authenticate(profile.id, guestSecret)).not.toBeNull(); // the first device stays signed in
    const again = await post(logoutPOST, '/api/auth/logout', { 'x-profile-id': profile.id, 'x-profile-secret': other.secret });
    expect(again.status).toBe(401);
  });

  it('wrong password and unknown email get the same generic 401', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    await signup(profile, { email: 'sam@example.com', password: 'eight chars' }, IP);
    const wrong = await expectHttp(login({ email: 'sam@example.com', password: 'nine chars!' }, IP), 401, 'invalid_login');
    const unknown = await expectHttp(login({ email: 'nobody@example.com', password: 'eight chars' }, IP), 401, 'invalid_login');
    expect(wrong.message).toBe(unknown.message);
    await expectHttp(login({ email: 'not an email', password: 'eight chars' }, IP), 401, 'invalid_login');
  });

  it('sign-up errors: account_exists, email_taken, bad input; the email is free again after deletion', async () => {
    const { profile: a } = await createProfile({ locale: 'en' });
    await signup(a, { email: 'kim@example.com', password: 'eight chars' }, IP);
    await expectHttp(signup((await getProfile(a.id))!, { email: 'kim2@example.com', password: 'eight chars' }, IP), 409, 'account_exists');
    const { profile: b } = await createProfile({ locale: 'en' });
    await expectHttp(signup(b, { email: 'KIM@example.com', password: 'eight chars' }, IP), 409, 'email_taken');
    await expectHttp(signup(b, { email: 'kim3@example', password: 'eight chars' }, IP), 400, 'invalid_email');
    await expectHttp(signup(b, { email: 'kim3@example.com', password: 'short' }, IP), 400, 'invalid_password');
    await expectHttp(signup(b, { email: 'demo-nurse@irreplaceable.demo', password: 'eight chars' }, IP), 400, 'invalid_email');
    expect((await getProfile(b.id))!.account).toBeUndefined();

    await deleteProfile(a.id);
    expect(await getStore().get(emailIndexKey('kim@example.com'))).toBeNull();
    await signup(b, { email: 'kim@example.com', password: 'eight chars' }, IP);
    expect((await login({ email: 'kim@example.com', password: 'eight chars' }, IP)).id).toBe(b.id);
  });

  it('a guest cannot log out (nothing could open the profile again)', async () => {
    const { profile, secret } = await createProfile({ locale: 'en' });
    await expectHttp(logout(profile, secret), 409, 'no_account');
  });

  it('10 log-in attempts per email in 15 minutes, then 429', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    await signup(profile, { email: 'lee@example.com', password: 'eight chars' }, IP);
    const now = new Date('2026-11-15T10:00:00Z');
    for (let i = 0; i < PER_EMAIL; i++) await expectHttp(login({ email: 'lee@example.com', password: 'wrong pass' }, IP, now), 401, 'invalid_login');
    const limited = await expectHttp(login({ email: 'lee@example.com', password: 'eight chars' }, IP, now), 429, 'rate_limited');
    expect(limited.extra?.retryAfter).toBeGreaterThan(0);
    // another email from the same network is not blocked; the next window opens again
    await expectHttp(login({ email: 'other@example.com', password: 'eight chars' }, IP, now), 401, 'invalid_login');
    expect((await login({ email: 'lee@example.com', password: 'eight chars' }, IP, new Date('2026-11-15T10:16:00Z'))).id).toBe(profile.id);
  });

  it('older profiles (one secretHash) still sign in, and keep it when an account is added', async () => {
    const { profile, secret } = await createProfile({ locale: 'en' });
    expect((await getProfile(profile.id))!.secretHashes).toBeUndefined();
    expect(await authenticate(profile.id, secret)).not.toBeNull();
    await signup(profile, { email: 'old@example.com', password: 'eight chars' }, IP);
    expect(await authenticate(profile.id, secret)).not.toBeNull();
  });
});

describe('gates', () => {
  it('checkout and the Cup offer need an account; demo accounts have Max and cannot check out', async () => {
    const { profile, secret } = await createProfile({ locale: 'en' });
    const headers = { 'x-profile-id': profile.id, 'x-profile-secret': secret };
    for (const [route, path] of [
      [checkoutPOST, '/api/billing/checkout'],
      [cupPOST, '/api/billing/cup'],
    ] as const) {
      const res = await post(route, path, headers, {});
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('account_required');
    }
    await signup(profile, { email: 'pat@example.com', password: 'eight chars' }, IP);
    expect((await post(checkoutPOST, '/api/billing/checkout', headers, { tier: 'pro' })).status).toBe(200);
    expect((await post(cupPOST, '/api/billing/cup', headers)).status).toBe(201);

    await updateProfile(profile.id, (p) => {
      p.demo = true;
    });
    const demo = await post(checkoutPOST, '/api/billing/checkout', headers, { tier: 'pro' });
    expect(demo.status).toBe(409);
    expect((await demo.json()).error.code).toBe('demo_account');
  });
});
