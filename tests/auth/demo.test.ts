import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumeAnalysis } from '@/server/xray/resume';

/**
 * Shared demo accounts with the model steps replaced: résumé analysis returns a fixed result for the
 * sample text it was given, the week proposal returns the occupation's typical week. The live pipeline is
 * checked against the dev server.
 */
const calls = vi.hoisted(() => ({ analyze: [] as string[], fail: false, gate: null as Promise<void> | null }));

vi.mock('@/server/xray/resume', async (orig) => {
  const real = await orig<typeof import('@/server/xray/resume')>();
  return {
    ...real,
    analyzeResume: async (input: { text: string }): Promise<ResumeAnalysis> => {
      calls.analyze.push(input.text);
      if (calls.gate) await calls.gate;
      if (calls.fail) {
        const { AiError } = await import('@/server/ai/client');
        throw new AiError('provider_error', 'both models failed');
      }
      const software = input.text.includes('JORDAN MERCER');
      return {
        facts: { title: software ? 'Software Engineer II' : 'Staff Nurse', seniorityYears: 6, industry: null, duties: [{ original: 'Duty', en: 'Duty' }], tools: [] },
        ranked: [software ? { code: '15-1252.00', title: 'Software Developers', localTitle: null, reason: '' } : { code: '29-1141.00', title: 'Registered Nurses', localTitle: null, reason: '' }],
        confidence: 0.9,
        truncated: false,
      };
    },
  };
});
vi.mock('@/server/xray/week', async (orig) => {
  const real = await orig<typeof import('@/server/xray/week')>();
  return { ...real, proposeWeek: async ({ bundle }: { bundle: Parameters<typeof real.typicalWeek>[0] }) => ({ ...real.typicalWeek(bundle), source: 'resume' as const }) };
});

import { POST as demoPOST } from '@/app/api/auth/demo/route';
import { login } from '@/server/auth';
import { setStripeForTests } from '@/server/billing';
import { demoEmail, openDemoAccount } from '@/server/demo';
import { authenticate, emailIndexKey, getProfile } from '@/server/profile';
import { getStore } from '@/server/store';
import { readXray } from '@/server/xray';
import { useTempStore } from '../platform/helpers';
import { createStripeStub } from '../billing/stripe-stub';

let cleanup: () => void;
beforeEach(() => {
  ({ cleanup } = useTempStore());
  setStripeForTests(createStripeStub().stripe);
  calls.analyze.length = 0;
  calls.fail = false;
  calls.gate = null;
});
afterEach(() => {
  setStripeForTests(null);
  cleanup();
});

const actor = { ip: '127.0.0.1' };

describe('shared demo accounts', () => {
  it('the first open builds a real map from the sample résumé with Max; later opens are the same account with a new device secret', async () => {
    const first = await openDemoAccount('nurse', actor);
    expect(first).toMatchObject({ created: true, email: 'demo-nurse@irreplaceable.demo' });
    expect(calls.analyze[0]).toContain('DANA WHITFIELD');
    const profile = (await getProfile(first.id))!;
    expect(profile).toMatchObject({ demo: true, account: { email: demoEmail('nurse') }, plan: { source: 'cup', tier: 'coach' }, tz: 'America/Chicago' });
    expect((await readXray(first.xrayId!))!).toMatchObject({ profileId: first.id, occupationCode: '29-1141.00', inputSource: 'resume' });

    const second = await openDemoAccount('nurse', actor);
    expect(second).toMatchObject({ id: first.id, created: false, xrayId: first.xrayId });
    expect(second.secret).not.toBe(first.secret);
    expect(await authenticate(first.id, first.secret)).not.toBeNull();
    expect(await authenticate(first.id, second.secret)).not.toBeNull();
    expect(calls.analyze).toHaveLength(1);

    // nobody can log in to it with a password
    await expect(login({ email: demoEmail('nurse'), password: 'anything at all' }, '127.0.0.1')).rejects.toMatchObject({ code: 'invalid_login' });
    // each persona is its own account
    const sw = await openDemoAccount('software', actor);
    expect(sw.id).not.toBe(first.id);
    expect((await readXray(sw.xrayId!))!.occupationCode).toBe('15-1252.00');
  });

  it('parallel first clicks build one account and both get into it', async () => {
    let open!: () => void;
    calls.gate = new Promise<void>((r) => (open = r));
    const a = openDemoAccount('accountant', actor);
    await new Promise((r) => setTimeout(r, 30));
    const b = openDemoAccount('accountant', actor);
    await new Promise((r) => setTimeout(r, 30));
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.id).toBe(rb.id);
    expect(ra.secret).not.toBe(rb.secret);
    expect(calls.analyze).toHaveLength(1);
  }, 20_000);

  it('a model failure leaves no half-built account, and the next click builds it', async () => {
    calls.fail = true;
    const err = await openDemoAccount('nurse', actor).then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('AiError');
    expect(await getStore().get(emailIndexKey(demoEmail('nurse')))).toBeNull();
    calls.fail = false;
    expect((await openDemoAccount('nurse', actor)).created).toBe(true);
  });

  it('POST /api/auth/demo: 201 then 200 with { id, secret, email, xrayId }; unknown persona 400', async () => {
    const call = (persona: string) => demoPOST(new Request('http://localhost/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona }) }));
    const a = await call('nurse');
    expect(a.status).toBe(201);
    const body = await a.json();
    expect(Object.keys(body).sort()).toEqual(['email', 'id', 'secret', 'xrayId']);
    const b = await call('nurse');
    expect(b.status).toBe(200);
    expect((await b.json()).id).toBe(body.id);
    expect((await call('pilot')).status).toBe(400);
  });
});
