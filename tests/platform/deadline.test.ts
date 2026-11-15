import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callModel } from '@/server/ai/client';
import { requestDeadline, ROUTE_MAX_DURATION_SEC, withRequestDeadline } from '@/server/ai/deadline';
import { readJob, writeJob } from '@/server/reps/records';
import { repState, STALE_JOB_MS } from '@/server/reps/service';
import { createProfile, updateProfile } from '@/server/profile';
import { useTempStore } from './helpers';

let cleanup: () => void;
const env = { ...process.env };
beforeEach(() => {
  ({ cleanup } = useTempStore());
  Object.assign(process.env, { OPENROUTER_API_KEY: 'test-key', AI_BUDGET_USD: '100', AI_DAILY_CAP_USD: '100' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  process.env = { ...env };
});

describe('request deadlines', () => {
  it('a request runs with a deadline a little before the route maxDuration; outside a request there is none', async () => {
    expect(requestDeadline()).toBeNull();
    const before = Date.now();
    const end = await withRequestDeadline(async () => requestDeadline());
    expect(end).toBeGreaterThan(before + (ROUTE_MAX_DURATION_SEC - 15) * 1000);
    expect(end).toBeLessThan(before + ROUTE_MAX_DURATION_SEC * 1000);
  });

  it('a model call with no time left in the request does not start (no attempt, no failover)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const call = withRequestDeadline(
      () => callModel({ op: 't', schema: z.object({ a: z.string() }), system: 's', user: 'u', locale: 'en', maxTokens: 50, temperature: 0 }),
      12, // 12 s route, 10 s kept for saving: 2 s left, less than one attempt needs
    );
    await expect(call).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a rep whose generating function was killed reads as failed after the route limit, not for ten minutes', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const id = 'abcdefghijklmn';
    const { profile: p } = await updateProfile(profile.id, (x) => {
      x.reps.push(id);
    });
    await writeJob(id, { status: 'generating', profileId: p.id, at: new Date().toISOString() });
    expect(await repState(id, p)).toEqual({ status: 'generating', repId: id });
    expect(await repState(id, p, new Date(Date.now() + STALE_JOB_MS + 1000))).toEqual({ status: 'failed', repId: id });
    expect((await readJob(id))?.status).toBe('generating');
  });
});
