import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepView } from '@/domain/reps';
import { AiError } from '@/server/ai/client';
import { createProfile, getProfile } from '@/server/profile';
import { createRep, resetBankCache, startTrial } from '@/server/reps';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { useTempStore } from '../platform/helpers';
import { nurseSlip, writeBank } from './fixtures';

/**
 * Live first: every rep, the trial included, is written by the model; the prepared bank is used only when
 * the model fails (budget, rate limit, provider) and then always carries `prepared_maintenance`.
 * The generator is stubbed so this runs without the network.
 */

const gen = vi.hoisted(() => ({ fail: null as null | 'budget_exceeded' | 'rate_limited' | 'provider_error', calls: 0 }));

vi.mock('@/server/reps/generate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/reps/generate')>();
  return {
    ...real,
    generateSlip: vi.fn(async (input: { taskId: string; occupationCode: string }) => {
      gen.calls++;
      if (gen.fail) throw new AiError(gen.fail, `stubbed ${gen.fail}`, { op: 'rep.slip' });
      const { nurseSlip: make } = await import('./fixtures');
      return { entry: { ...make(input.taskId), title: 'Live document' }, attempts: 1, costUsd: 0, rejected: [] };
    }),
  };
});

const NURSE = '29-1141.00';
const env = { ...process.env };
let bankDir: string;
let cleanup: () => void;

beforeAll(() => {
  bankDir = mkdtempSync(path.join(tmpdir(), 'irr-bank-'));
  Object.assign(process.env, { REP_BANK_DIR: bankDir, DEV_FORCE_PRO: '1' });
});
afterAll(() => {
  process.env = env;
  rmSync(bankDir, { recursive: true, force: true });
});
beforeEach(async () => {
  ({ cleanup } = useTempStore());
  gen.fail = null;
  gen.calls = 0;
  const bundle = (await loadBundle(NURSE))!;
  writeBank(bankDir, [nurseSlip(typicalWeek(bundle).shares[0].taskId)]);
  resetBankCache();
});
afterEach(() => cleanup());

async function nurseCtx(now = '2026-11-14T15:00:00Z') {
  const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
  const bundle = (await loadBundle(NURSE))!;
  await createXray({ profile, occupationCode: NURSE, shares: typicalWeek(bundle).shares, jobTitle: 'RN', inputSource: 'title' });
  return { profile: (await getProfile(profile.id))!, headerTz: 'America/Chicago', now: new Date(now) };
}

describe('live first, bank only when the model cannot run', () => {
  it('the trial is written live even though a bank rep exists for the occupation', async () => {
    const t = (await startTrial(await nurseCtx())) as { rep: RepView };
    expect(gen.calls).toBe(1);
    expect(t.rep).toMatchObject({ source: 'live', title: 'Live document', notes: [] });
  });

  for (const code of ['budget_exceeded', 'rate_limited', 'provider_error'] as const) {
    it(`on ${code} the trial comes from the bank with the prepared_maintenance notice`, async () => {
      gen.fail = code;
      const t = (await startTrial(await nurseCtx())) as { rep: RepView };
      expect(t.rep.source).toBe('bank');
      expect(t.rep.notes[0]).toBe('prepared_maintenance');
    });
  }

  it('daily and extra reps follow the same rule', async () => {
    const ctx = await nurseCtx();
    const live = (await createRep(ctx, { type: 'slip', kind: 'daily' })) as { rep: RepView };
    expect(live.rep).toMatchObject({ source: 'live', notes: [] });
    gen.fail = 'budget_exceeded';
    const bank = (await createRep({ ...ctx, profile: (await getProfile(ctx.profile.id))! }, { type: 'slip', kind: 'extra' })) as { rep: RepView };
    expect(bank.rep).toMatchObject({ source: 'bank', notes: ['prepared_maintenance'] });
  });
});
