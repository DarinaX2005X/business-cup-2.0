import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumeAnalysis } from '@/server/xray/resume';

/**
 * The jury account orchestration with the model steps replaced: résumé analysis returns a fixed result
 * for the sample text it was given, the week proposal returns the occupation's typical week. The live
 * pipeline itself is checked against the dev server (see the stage report).
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
        facts: {
          title: software ? 'Software Engineer II' : 'Staff Nurse',
          seniorityYears: 6,
          industry: null,
          duties: [{ original: 'Review pull requests', en: 'Review pull requests' }],
          tools: [],
        },
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

import { POST as juryPOST } from '@/app/api/demo/jury/route';
import { setStripeForTests } from '@/server/billing';
import { openJuryAccount } from '@/server/demo';
import { createProfile, getProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { readXray } from '@/server/xray';
import { useTempStore } from '../platform/helpers';
import { createStripeStub } from './stripe-stub';

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

const actor = { profileId: null, ip: '127.0.0.1' };

describe('jury account', () => {
  it('builds the map from the sample résumé, unlocks Coach and marks the profile as a demo; a repeat costs nothing', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const res = await openJuryAccount(profile, 'nurse', actor);
    expect(res.created).toBe(true);
    expect(calls.analyze[0]).toContain('DANA WHITFIELD'); // the real sample text went into the pipeline
    expect(res.plan).toMatchObject({ status: 'pro', source: 'cup', tier: 'coach' });

    const xray = (await readXray(res.xrayId))!;
    expect(xray).toMatchObject({ profileId: profile.id, occupationCode: '29-1141.00', jobTitle: 'Staff Nurse', inputSource: 'resume' });
    const saved = (await getProfile(profile.id))!;
    expect(saved).toMatchObject({ demo: true, demoXrays: { nurse: res.xrayId }, lastXrayId: res.xrayId, resumeFacts: { title: 'Staff Nurse' } });
    expect(saved.points.balance).toBe(120); // the map earns its points like any other

    const again = await openJuryAccount(saved, 'nurse', actor);
    expect(again).toMatchObject({ xrayId: res.xrayId, created: false });
    expect(calls.analyze).toHaveLength(1);
  });

  it('the software engineer sample maps to software developers', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const res = await openJuryAccount(profile, 'software', actor);
    expect(calls.analyze[0]).toContain('JORDAN MERCER');
    expect((await readXray(res.xrayId))!.occupationCode).toBe('15-1252.00');
  });

  it('a parallel click is 409 in_progress; a model failure saves nothing and can be retried', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    let open!: () => void;
    calls.gate = new Promise<void>((r) => (open = r));
    const first = openJuryAccount(profile, 'accountant', actor);
    await new Promise((r) => setTimeout(r, 20));
    const second = await openJuryAccount(profile, 'accountant', actor).then(() => null, (e: unknown) => e);
    expect(second).toBeInstanceOf(HttpError);
    expect((second as HttpError).code).toBe('in_progress');
    calls.fail = true;
    open();
    await expect(first).rejects.toMatchObject({ name: 'AiError' });
    const after = (await getProfile(profile.id))!;
    expect(after.demo).toBeUndefined();
    expect(after.xrays).toEqual([]);

    calls.gate = null;
    calls.fail = false;
    const retry = await openJuryAccount(after, 'accountant', actor);
    expect(retry.created).toBe(true);
  });

  it('POST /api/demo/jury: 201 with the map id and the Coach plan; unknown persona 400', async () => {
    const { profile, secret } = await createProfile({ locale: 'en' });
    const headers = { 'x-profile-id': profile.id, 'x-profile-secret': secret, 'content-type': 'application/json' };
    const call = (persona: string) => juryPOST(new Request('http://localhost/api/demo/jury', { method: 'POST', headers, body: JSON.stringify({ persona }) }));
    const res = await call('nurse');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ xrayId: expect.any(String), plan: { tier: 'coach' } });
    expect((await call('nurse')).status).toBe(200);
    expect((await call('pilot')).status).toBe(400);
  });
});
