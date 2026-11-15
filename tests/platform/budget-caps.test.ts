import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reserveBudget } from '@/server/ai/budget';
import { useTempStore } from './helpers';

/** The visitor's own dollar caps (per profile, and per IP for calls without a profile), beside the global ones. */

let cleanup: () => void;
const env = { ...process.env };
beforeEach(() => {
  ({ cleanup } = useTempStore());
  Object.assign(process.env, { AI_BUDGET_USD: '100', AI_DAILY_CAP_USD: '100', AI_PROFILE_DAILY_USD: '0.1', AI_ANON_IP_DAILY_USD: '0.15' });
});
afterEach(() => {
  cleanup();
  process.env = { ...env };
});

describe('per-visitor dollar caps', () => {
  it('a profile stops at its daily cap (sub-buckets count as the profile); another profile is not affected', async () => {
    const a = await reserveBudget(0.06, { profileId: 'pA', ip: '1.1.1.1' });
    expect(a.ok).toBe(true);
    if (a.ok) await a.reservation.settle(0.06);
    const b = await reserveBudget(0.06, { profileId: 'pA:playbook', ip: '1.1.1.1' });
    expect(b).toMatchObject({ ok: false, denial: { code: 'rate_limited' } });
    expect((await reserveBudget(0.06, { profileId: 'pB', ip: '1.1.1.1' })).ok).toBe(true);
  });

  it('a released or cheaper call gives its money back to the cap', async () => {
    const a = await reserveBudget(0.09, { profileId: 'pC' });
    if (a.ok) await a.reservation.release();
    const b = await reserveBudget(0.09, { profileId: 'pC' });
    expect(b.ok).toBe(true);
    if (b.ok) await b.reservation.settle(0.01);
    expect((await reserveBudget(0.08, { profileId: 'pC' })).ok).toBe(true);
  });

  it('calls without a profile share a cap per IP', async () => {
    const a = await reserveBudget(0.1, { ip: '2.2.2.2' });
    expect(a.ok).toBe(true);
    if (a.ok) await a.reservation.settle(0.1);
    expect(await reserveBudget(0.1, { ip: '2.2.2.2' })).toMatchObject({ ok: false, denial: { code: 'rate_limited' } });
    expect((await reserveBudget(0.1, { ip: '3.3.3.3' })).ok).toBe(true);
    // the same network with a profile counts against the profile instead
    expect((await reserveBudget(0.09, { profileId: 'pD', ip: '2.2.2.2' })).ok).toBe(true);
  });

  it('the defaults are generous: $2 a profile and $5 an IP a day', async () => {
    delete process.env.AI_PROFILE_DAILY_USD;
    delete process.env.AI_ANON_IP_DAILY_USD;
    const { dollarCaps } = await import('@/server/ai/budget');
    expect(dollarCaps()).toEqual({ profileDailyUsd: 2, anonIpDailyUsd: 5 });
  });
});
