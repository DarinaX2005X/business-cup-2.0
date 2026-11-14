import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointsAward, Profile } from '@/domain/types';
import { DELETE, GET, PATCH, POST } from '@/app/api/profile/route';
import { authenticate, createProfile, deleteProfile, getProfile, isPro, profileKey, updateProfile } from '@/server/profile';
import { hashSecret, newProfileId, verifySecret } from '@/server/profile/ids';
import { withApi } from '@/server/profile/http';
import { emit, type Subscriber } from '@/server/events';
import type { Store } from '@/server/store';
import { useTempStore } from './helpers';

let store: Store;
let cleanup: () => void;
beforeEach(() => ({ store, cleanup } = useTempStore()));
afterEach(() => cleanup());

const url = 'http://localhost/api/profile';
function req(method: string, creds?: { id: string; secret: string } | null, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: {
      ...(creds ? { 'x-profile-id': creds.id, 'x-profile-secret': creds.secret } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function newProfileViaApi() {
  const res = await POST(req('POST', null, { locale: 'ru' }, { 'x-tz': 'Asia/Almaty', 'x-forwarded-for': '10.0.0.1' }));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; secret: string };
}

describe('ids and secrets', () => {
  it('makes 22-char base62 ids and compares secrets by hash', () => {
    const ids = new Set(Array.from({ length: 500 }, newProfileId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(verifySecret('abc', hashSecret('abc'))).toBe(true);
    expect(verifySecret('abd', hashSecret('abc'))).toBe(false);
  });
});

describe('/api/profile', () => {
  it('creates, reads without the secret hash, and rejects a wrong secret', async () => {
    const creds = await newProfileViaApi();
    expect(creds.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await GET(req('GET', creds));
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ id: creds.id, version: 1, locale: 'ru', tz: 'Asia/Almaty', points: { balance: 0 }, plan: { status: 'free' } });
    expect(p).not.toHaveProperty('secretHash');
    const stored = await store.get<Profile>(profileKey(creds.id));
    expect(stored?.value.secretHash).toBe(hashSecret(creds.secret));
    expect(JSON.stringify(stored)).not.toContain(creds.secret);

    expect((await GET(req('GET', { id: creds.id, secret: 'x'.repeat(43) }))).status).toBe(401);
    const noAuth = await GET(req('GET'));
    expect(noAuth.status).toBe(401);
    expect(await noAuth.json()).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  it('validates input', async () => {
    expect((await POST(req('POST', null, { locale: 'de' }))).status).toBe(400);
    expect((await POST(req('POST', null, '{oops'))).status).toBe(400);
    const creds = await newProfileViaApi();
    expect((await PATCH(req('PATCH', creds, { secretHash: 'x' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', creds, { tz: 'Mars/Base' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', creds, {}))).status).toBe(400);
  });

  it('keeps every change when two tabs patch the same profile at the same time', async () => {
    const creds = await newProfileViaApi();
    const tabA = Array.from({ length: 10 }, (_, i) => `a${i}`);
    const tabB = Array.from({ length: 10 }, (_, i) => `b${i}`);
    const run = async (hints: string[]) => {
      for (const h of hints) {
        const res = await PATCH(req('PATCH', creds, { hintsSeen: [h] }));
        expect(res.status).toBe(200);
      }
    };
    await Promise.all([run(tabA), run(tabB), PATCH(req('PATCH', creds, { salary: 72000, sound: false }))]);
    const p = await (await GET(req('GET', creds))).json();
    expect([...p.hintsSeen].sort()).toEqual([...tabA, ...tabB].sort());
    expect(p.salary).toBe(72000);
    expect(p.sound).toBe(false);
    expect(p.version).toBe(22);
  });

  it('deletes the profile and everything it owns', async () => {
    const creds = await newProfileViaApi();
    await updateProfile(creds.id, (p) => {
      p.xrays.push('X1');
      p.reps.push('R1');
    });
    await store.set('xray:X1', { id: 'X1' });
    await store.set('rep:R1', { id: 'R1' });
    await store.incrFloat(`rl:profile:${creds.id}:2026-11-14`, 3);
    await store.set('xray:OTHER', { id: 'OTHER' });

    expect((await DELETE(req('DELETE', creds))).status).toBe(200);
    expect((await GET(req('GET', creds))).status).toBe(401);
    expect(await store.get(profileKey(creds.id))).toBeNull();
    expect(await store.get('xray:X1')).toBeNull();
    expect(await store.get('rep:R1')).toBeNull();
    expect(await store.list(`rl:profile:${creds.id}:`)).toEqual([]);
    expect(await store.get('xray:OTHER')).not.toBeNull();
    expect((await DELETE(req('DELETE', creds))).status).toBe(401);
  });

  it('limits new profiles per network per day', async () => {
    for (let i = 0; i < 30; i++) expect((await POST(req('POST', null, { locale: 'en' }, { 'x-forwarded-for': '9.9.9.9' }))).status).toBe(201);
    const res = await POST(req('POST', null, { locale: 'en' }, { 'x-forwarded-for': '9.9.9.9' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('rate_limited');
  }, 20_000);
});

describe('updateProfile', () => {
  it('re-applies the mutation on a race and protects id, secretHash and version', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const n = 12;
    await Promise.all(
      Array.from({ length: n }, () =>
        updateProfile(profile.id, (p) => {
          p.points.balance += 1;
        }).catch(async () =>
          // more than 3 lost races in a row is possible with 12 writers; a caller would show 409 and retry
          updateProfile(profile.id, (p) => {
            p.points.balance += 1;
          }),
        ),
      ),
    );
    const after = await getProfile(profile.id);
    expect(after!.points.balance).toBe(n);
    const { profile: tampered } = await updateProfile(profile.id, (p) => ({ ...p, id: 'evil', secretHash: 'x', version: 999 }));
    expect(tampered.id).toBe(profile.id);
    expect(tampered.secretHash).toBe(profile.secretHash);
    expect(tampered.version).toBe(after!.version + 1);
  });

  it('re-reads and re-applies when another server instance wrote in between (no lost write)', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    let calls = 0;
    const { profile: after } = await updateProfile(profile.id, async (p) => {
      calls++;
      if (calls === 1) {
        // another instance saves its change after we read but before we write
        const cur = await store.get<Profile>(profileKey(profile.id));
        await store.set(profileKey(profile.id), { ...cur!.value, salary: 50000, version: cur!.version + 1 }, { version: cur!.version });
      }
      p.hintsSeen.push('mine');
    });
    expect(calls).toBe(2);
    expect(after).toMatchObject({ salary: 50000, hintsSeen: ['mine'], version: 3 });
    expect(await getProfile(profile.id)).toMatchObject({ salary: 50000, hintsSeen: ['mine'], version: 3 });
  });

  it('gives up with a conflict after 3 retries instead of overwriting', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const attempt = updateProfile(profile.id, async (p) => {
      const cur = await store.get<Profile>(profileKey(profile.id));
      await store.set(profileKey(profile.id), { ...cur!.value, version: cur!.version + 1 }, { version: cur!.version });
      p.salary = 1;
    });
    await expect(attempt).rejects.toMatchObject({ name: 'ConflictError' });
    expect((await getProfile(profile.id))!.salary).toBeUndefined();
  });

  it('authenticate rejects unknown ids and malformed input', async () => {
    expect(await authenticate('short', 'x')).toBeNull();
    expect(await authenticate(newProfileId(), 'a'.repeat(43))).toBeNull();
    expect(await deleteProfile(newProfileId())).toBeUndefined();
  });
});

describe('isPro', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  it.each([
    [{ status: 'free' }, {}, false],
    [{ status: 'pro', periodEnd: future }, {}, true],
    [{ status: 'trialing', periodEnd: future }, {}, true],
    [{ status: 'pro', periodEnd: past }, {}, false],
    [{ status: 'pro' }, {}, false],
    [{ status: 'free' }, { DEV_FORCE_PRO: '1', NODE_ENV: 'development' }, true],
    [{ status: 'free' }, { DEV_FORCE_PRO: '1', NODE_ENV: 'production' }, false],
  ] as const)('%o with %o → %s', (plan, env, expected) => {
    expect(isPro({ plan: plan as Profile['plan'] }, new Date(), env as NodeJS.ProcessEnv)).toBe(expected);
  });
});

describe('events', () => {
  const award: PointsAward = { type: 'xray_completed', points: 40, labelKey: 'points.xray_completed' };
  const seenRefs: string[] = [];
  /** Test subscriber: awards 40 once per ref (idempotency is the subscriber's job). */
  const testSubscriber: Subscriber = (profile, event) => {
    seenRefs.push(event.ref);
    if (event.type !== 'xray_completed') return;
    if (profile.points.events.some((e) => e.ref === event.ref && e.type === 'xray_completed')) return;
    return {
      profile: {
        ...profile,
        points: {
          balance: profile.points.balance + 40,
          events: [...profile.points.events, { id: `ev-${event.ref}`, type: 'xray_completed', points: 40, ref: event.ref, at: event.at }],
        },
      },
      awards: [award],
    };
  };

  /** What a stage 02–05 route looks like: mutate + emit inside updateProfile, return awards as pointsAwarded. */
  const testRoute = withApi(async (request: Request) => {
    const body = (await request.json()) as { id: string; ref: string };
    const { profile, awards } = await updateProfile(body.id, (p) => {
      p.lastXrayId = body.ref;
      return emit(p, { type: 'xray_completed', ref: body.ref, data: { score: 61 } }, [testSubscriber]);
    });
    return Response.json({ balance: profile.points.balance, pointsAwarded: awards });
  });

  it('a route with emit returns pointsAwarded from the subscriber and saves its change in the same write', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const call = (ref: string) =>
      testRoute(new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify({ id: profile.id, ref }) }));

    const first = await (await call('X1')).json();
    expect(first).toEqual({ balance: 40, pointsAwarded: [award] });
    const stored = await getProfile(profile.id);
    expect(stored).toMatchObject({ lastXrayId: 'X1', version: 2, points: { balance: 40 } });

    const repeat = await (await call('X1')).json();
    expect(repeat).toEqual({ balance: 40, pointsAwarded: [] });
    expect(seenRefs.filter((r) => r === 'X1')).toHaveLength(2); // same ref delivered again, subscriber ignored it
  });

  it('refuses emit outside updateProfile', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    expect(() => emit(profile, { type: 'week_confirmed', ref: 'w1' })).toThrow(/inside updateProfile/);
  });

  it('awards from a lost race are not reported twice', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const spy = vi.fn(testSubscriber);
    const results = await Promise.all(
      ['A', 'B'].map((ref) => updateProfile(profile.id, (p) => emit(p, { type: 'xray_completed', ref }, [spy]))),
    );
    expect(results.map((r) => r.awards)).toEqual([[award], [award]]);
    expect((await getProfile(profile.id))!.points.balance).toBe(80);
  });
});
