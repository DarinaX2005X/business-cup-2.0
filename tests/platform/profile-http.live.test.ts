import { describe, expect, it } from 'vitest';

/**
 * Against a running app (default http://localhost:3000, override with APP_URL), with whatever store
 * it is configured for (Redis locally under `irr:dev:`). Creates one profile and deletes it at the end.
 *   npm run dev   then   npx vitest run --config vitest.live.config.ts tests/platform/profile-http.live.test.ts
 */
const BASE = process.env.APP_URL ?? 'http://localhost:3000';

async function call(method: string, creds: { id: string; secret: string } | null, body?: unknown) {
  const res = await fetch(`${BASE}/api/profile`, {
    method,
    headers: {
      ...(creds ? { 'x-profile-id': creds.id, 'x-profile-secret': creds.secret } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'x-tz': 'Asia/Almaty',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

describe('profile over HTTP', () => {
  it('survives two tabs writing at once, a second device, and deletion', async () => {
    const created = await call('POST', null, { locale: 'en' });
    expect(created.status).toBe(201);
    const creds = created.json as { id: string; secret: string };
    try {
      const tab = (prefix: string) => async () => {
        for (let i = 0; i < 8; i++) {
          const r = await call('PATCH', creds, { hintsSeen: [`${prefix}${i}`] });
          expect(r.status).toBe(200);
        }
      };
      await Promise.all([tab('a')(), tab('b')(), call('PATCH', creds, { locale: 'kk', salary: 65000 })]);

      // "second device": only id + secret, as carried by the restore link
      const other = await call('GET', { ...creds });
      expect(other.status).toBe(200);
      expect(other.json.hintsSeen).toHaveLength(16);
      expect(other.json).toMatchObject({ locale: 'kk', salary: 65000, version: 18, tz: 'Asia/Almaty' });
      expect(other.json).not.toHaveProperty('secretHash');
    } finally {
      expect((await call('DELETE', creds)).status).toBe(200);
    }
    expect((await call('GET', creds)).status).toBe(401);
  });
});
