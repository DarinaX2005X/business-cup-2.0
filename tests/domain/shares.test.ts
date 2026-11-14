import { describe, expect, it } from 'vitest';
import { apportion, defaultShares, normalizeShares, redistributeShares } from '@/domain/shares';
import type { WeekShare } from '@/domain/types';
import { bundle, fixture, task } from './helpers';

const sum = (s: WeekShare[]) => s.reduce((a, x) => a + x.share, 0);

describe('apportion', () => {
  it('sums exactly with a minimum per item', () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([1000, 1, 1], 100)).toEqual([98, 1, 1]);
    expect(apportion([0, 0], 10)).toEqual([5, 5]);
  });
});

describe('defaultShares', () => {
  it('keeps the top 12 tasks by importance × log1p(frequency), integer shares summing to 100', () => {
    const rn = fixture('29-1141.00');
    const s = defaultShares(rn);
    expect(s).toHaveLength(12);
    expect(sum(s)).toBe(100);
    expect(s.every((x) => Number.isInteger(x.share) && x.share >= 1)).toBe(true);
    const ids = new Set(rn.tasks.map((t) => t.id));
    expect(s.every((x) => ids.has(x.taskId))).toBe(true);
  });
  it('uses importance alone without frequency and equal weights without ratings', () => {
    const noFreq = bundle([task('1', 'ai_speeds', { importance: 5, frequency: null }), task('2', 'ai_speeds', { importance: 1, frequency: null })]);
    expect(defaultShares(noFreq)).toEqual([{ taskId: '1', share: 83 }, { taskId: '2', share: 17 }]);
    const unrated = bundle([task('1', 'ai_speeds', { importance: null, frequency: null }), task('2', 'ai_speeds', { importance: null, frequency: null })]);
    expect(defaultShares(unrated)).toEqual([{ taskId: '1', share: 50 }, { taskId: '2', share: 50 }]);
  });
});

describe('normalizeShares', () => {
  const b = bundle(['1', '2', '3'].map((id) => task(id, 'ai_speeds')));
  it('drops unknown IDs, duplicates, negative, zero and non-numeric shares and rescales to 100', () => {
    const s = normalizeShares(
      [
        { taskId: '1', share: 30 },
        { taskId: 'nope', share: 50 },
        { taskId: '2', share: -5 },
        { taskId: '1', share: 99 },
        { taskId: '3', share: 10 },
        { taskId: '2', share: Number.NaN },
      ],
      b,
    );
    expect(s).toEqual([{ taskId: '1', share: 75 }, { taskId: '3', share: 25 }]);
  });
  it('gives every kept task at least 1 and keeps at most 14 tasks', () => {
    const many = bundle(Array.from({ length: 20 }, (_, i) => task(String(i), 'ai_speeds')));
    const s = normalizeShares([{ taskId: '0', share: 1000 }, ...Array.from({ length: 19 }, (_, i) => ({ taskId: String(i + 1), share: 0.01 }))], many);
    expect(s).toHaveLength(14);
    expect(sum(s)).toBe(100);
    expect(Math.min(...s.map((x) => x.share))).toBe(1);
  });
  it('returns [] when nothing valid is left', () => {
    expect(normalizeShares([{ taskId: 'x', share: 10 }], b)).toEqual([]);
  });
});

describe('redistributeShares', () => {
  const s: WeekShare[] = [
    { taskId: 'a', share: 50 },
    { taskId: 'b', share: 30 },
    { taskId: 'c', share: 20 },
  ];
  it('rescales the others proportionally and keeps the total at 100', () => {
    const r = redistributeShares(s, 'a', 20);
    expect(r).toEqual([{ taskId: 'a', share: 20 }, { taskId: 'b', share: 48 }, { taskId: 'c', share: 32 }]);
  });
  it('clamps extremes so every task keeps at least 1%', () => {
    expect(redistributeShares(s, 'a', 100)).toEqual([{ taskId: 'a', share: 98 }, { taskId: 'b', share: 1 }, { taskId: 'c', share: 1 }]);
    expect(redistributeShares(s, 'a', 0)[0].share).toBe(1);
    expect(redistributeShares(s, 'a', -40)[0].share).toBe(1);
    expect(sum(redistributeShares(s, 'b', 0))).toBe(100);
  });
  it('single task stays at 100; unknown task leaves the list unchanged', () => {
    expect(redistributeShares([{ taskId: 'a', share: 100 }], 'a', 10)).toEqual([{ taskId: 'a', share: 100 }]);
    expect(redistributeShares(s, 'zzz', 10)).toEqual(s);
  });
  it('preserves the order and sum over many random edits', () => {
    let cur = defaultShares(fixture('13-2011.00'));
    for (let i = 0; i < 200; i++) {
      const target = cur[(i * 7) % cur.length].taskId;
      cur = redistributeShares(cur, target, (i * 37) % 120);
      expect(sum(cur)).toBe(100);
      expect(Math.min(...cur.map((x) => x.share))).toBeGreaterThanOrEqual(1);
    }
  });
});
