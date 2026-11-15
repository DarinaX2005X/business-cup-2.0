import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumeAnalysis } from '@/server/xray/resume';

/**
 * Shared demo accounts with the model steps replaced: résumé analysis returns a fixed result for the
 * sample text it was given, the week proposal returns the occupation's typical week. The live pipeline is
 * checked against the dev server.
 */
const calls = vi.hoisted(() => ({ analyze: [] as string[], grow: [] as string[], fail: false, gate: null as Promise<void> | null }));

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

// Skills and the plan are model calls too: record them instead of calling the model.
vi.mock('@/server/growth', async (orig) => {
  const real = await orig<typeof import('@/server/growth')>();
  return {
    ...real,
    extractSkills: async (input: { xrayId?: string | null }) => {
      calls.grow.push(`skills:${input.xrayId}`);
      return {} as never;
    },
    getPlan: async (input: { xrayId?: string | null }) => {
      calls.grow.push(`plan:${input.xrayId}`);
      return {} as never;
    },
  };
});

import { POST as demoPOST } from '@/app/api/auth/demo/route';
import { boardHandle } from '@/domain/points';
import { login } from '@/server/auth';
import { setStripeForTests } from '@/server/billing';
import { demoEmail, openDemoAccount } from '@/server/demo';
import { planKey, readPlan } from '@/server/growth';
import { authenticate, emailIndexKey, getProfile, updateProfile } from '@/server/profile';
import { getStore } from '@/server/store';
import { readXray } from '@/server/xray';
import { useTempStore } from '../platform/helpers';
import { createStripeStub } from '../billing/stripe-stub';

let cleanup: () => void;
beforeEach(() => {
  ({ cleanup } = useTempStore());
  setStripeForTests(createStripeStub().stripe);
  calls.analyze.length = 0;
  calls.grow.length = 0;
  calls.fail = false;
  calls.gate = null;
});
afterEach(() => {
  setStripeForTests(null);
  cleanup();
});

const actor = { ip: '127.0.0.1' };

describe('jury demo accounts: one template per persona, a private copy per click', () => {
  it('the first click builds the template from the sample résumé; every click gets its own copy with Max, never the template', async () => {
    const first = await openDemoAccount('nurse', actor);
    expect(first.created).toBe(true);
    expect(first.email).toMatch(/^demo-nurse-[0-9a-f]{8}@irreplaceable\.demo$/);
    expect(calls.analyze[0]).toContain('DANA WHITFIELD');
    const template = (await getProfile((await getStore().get<{ profileId: string }>(emailIndexKey(demoEmail('nurse'))))!.value.profileId))!;
    expect(template).toMatchObject({ demo: true, demoTemplate: true, secretHashes: [] });
    expect(first.id).not.toBe(template.id);

    const copy = (await getProfile(first.id))!;
    expect(copy).toMatchObject({ demo: true, plan: { source: 'cup', tier: 'coach' }, tz: 'America/Chicago' });
    expect(copy.demoTemplate).toBeUndefined();
    const map = (await readXray(first.xrayId!))!;
    expect(map).toMatchObject({ profileId: first.id, occupationCode: '29-1141.00', inputSource: 'resume' });
    expect(map.id).not.toBe(template.demoXrays?.nurse);
    expect(await authenticate(first.id, first.secret)).not.toBeNull();

    // the next click: another copy, no new model calls, the first copy untouched
    const second = await openDemoAccount('nurse', actor);
    expect(second.id).not.toBe(first.id);
    expect(second.xrayId).not.toBe(first.xrayId);
    expect(calls.analyze).toHaveLength(1);
    expect(await authenticate(first.id, second.secret)).toBeNull();
    // the template cannot be signed in to: no device secret, no password
    await expect(login({ email: demoEmail('nurse'), password: 'anything at all' }, '127.0.0.1')).rejects.toMatchObject({ code: 'invalid_login' });
    // each persona has its own template
    const sw = await openDemoAccount('software', actor);
    expect((await readXray(sw.xrayId!))!.occupationCode).toBe('15-1252.00');
  }, 20_000);

  it("a copy carries the template's skills and its written plan under the copy's own map", async () => {
    await openDemoAccount('accountant', actor);
    const templateId = (await getStore().get<{ profileId: string }>(emailIndexKey(demoEmail('accountant'))))!.value.profileId;
    const template = (await getProfile(templateId))!;
    const templateMap = template.demoXrays!.accountant!;
    const skills = { items: [{ id: 'sk1', name: 'Reconciliation', kind: 'skill', source: 'resume' }], shown: [], checked: [], removed: [], occupationCode: null, textHash: null, seniorityYears: null, extractedAt: null, updatedAt: new Date().toISOString() };
    await updateProfile(templateId, (p) => {
      (p as unknown as { skills: unknown }).skills = skills;
    });
    await getStore().set(planKey(templateMap), { id: 'plan1', xrayId: templateMap, profileId: templateId, occupationCode: 'x', jobTitle: 'Accountant', inputsKey: 'k', weeks: [], createdAt: new Date().toISOString() });
    const copy = await openDemoAccount('accountant', actor);
    expect((await getProfile(copy.id))!.skills?.items[0]).toMatchObject({ name: 'Reconciliation' });
    expect(await readPlan(copy.xrayId!)).toMatchObject({ id: 'plan1', xrayId: copy.xrayId, profileId: copy.id });
    expect(await readPlan(templateMap)).toMatchObject({ profileId: templateId });
  });

  it('parallel first clicks build one template and each get their own copy', async () => {
    let open!: () => void;
    calls.gate = new Promise<void>((r) => (open = r));
    const a = openDemoAccount('accountant', actor);
    await new Promise((r) => setTimeout(r, 30));
    const b = openDemoAccount('accountant', actor);
    await new Promise((r) => setTimeout(r, 30));
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.id).not.toBe(rb.id);
    expect(calls.analyze).toHaveLength(1);
  }, 20_000);

  it('a model failure leaves no half-built template, and the next click builds it', async () => {
    calls.fail = true;
    const err = await openDemoAccount('nurse', actor).then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('AiError');
    expect(await getStore().get(emailIndexKey(demoEmail('nurse')))).toBeNull();
    calls.fail = false;
    expect((await openDemoAccount('nurse', actor)).created).toBe(true);
  });

  it('POST /api/auth/demo: 201 with { id, secret, email, xrayId } per click; unknown persona 400; limited per IP and hour', async () => {
    process.env.DEMO_OPENS_PER_HOUR = '3';
    try {
      const call = (persona: string) =>
        demoPOST(new Request('http://localhost/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.2.3' }, body: JSON.stringify({ persona }) }));
      const a = await call('nurse');
      expect(a.status).toBe(201);
      const body = await a.json();
      expect(Object.keys(body).sort()).toEqual(['email', 'id', 'secret', 'xrayId']);
      const b = await call('nurse');
      expect(b.status).toBe(201);
      expect((await b.json()).id).not.toBe(body.id);
      expect((await call('pilot')).status).toBe(400);
      expect((await call('nurse')).status).toBe(201);
      const over = await call('nurse');
      expect(over.status).toBe(429);
      expect((await over.json()).error.code).toBe('rate_limited');
    } finally {
      delete process.env.DEMO_OPENS_PER_HOUR;
    }
  });

  it('templates are kept off the leaderboard; copies are ranked like anyone', async () => {
    const { syncBoard, readBoard, useRecordBoardForTests } = await import('@/server/leaderboard');
    useRecordBoardForTests(true);
    try {
      const copy = await openDemoAccount('nurse', actor);
      const templateId = (await getStore().get<{ profileId: string }>(emailIndexKey(demoEmail('nurse'))))!.value.profileId;
      await syncBoard((await getProfile(templateId))!);
      await syncBoard((await getProfile(copy.id))!);
      const board = await readBoard(null);
      const handles = board.top.map((r) => r.handle);
      expect(handles).toContain(boardHandle((await getProfile(copy.id))!));
      expect(handles).not.toContain(boardHandle((await getProfile(templateId))!));
    } finally {
      useRecordBoardForTests(false);
    }
  });
});
