import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultShares } from '@/domain/shares';
import type { OccupationBundle } from '@/domain/types';
import { carryWeek } from './carry';

const load = (c: string) => JSON.parse(readFileSync(`public/data/occ/${c}.json`, 'utf8')) as OccupationBundle;

describe('carryWeek', () => {
  it('keeps a week unchanged when moved into the same job', () => {
    const rn = load('29-1141.00');
    const week = defaultShares(rn);
    const res = carryWeek(rn, week, rn);
    expect(res.carried).toBe(100);
    expect(res.shares).toEqual(week);
    expect(res.fresh).toEqual([]);
  });

  it('moves a nurse week into a close job: most hours carry over, shares stay a valid week', () => {
    const rn = load('29-1141.00');
    const res = carryWeek(rn, defaultShares(rn), load('29-1141.01'));
    expect(res.carried).toBeGreaterThan(50);
    expect(res.shares.reduce((n, s) => n + s.share, 0)).toBe(100);
    expect(res.shares.every((s) => Number.isInteger(s.share) && s.share >= 1)).toBe(true);
  });

  it('falls back to the typical week when nothing matches', () => {
    const target = load('47-2111.00');
    const res = carryWeek({ tasks: [] }, [{ taskId: 'x', share: 100 }], target);
    expect(res.carried).toBe(0);
    expect(res.shares).toEqual(defaultShares(target));
  });
});
