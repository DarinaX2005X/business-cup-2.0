import { describe, expect, it } from 'vitest';
import { REP_POINTS, repPoints } from '@/domain/points';
import { nextSlipHint, slipHintSpot } from '@/domain/reps';

describe('Spot the slip hints', () => {
  const doc = '# Shift note\n\nPatient took 50 mg at 9 pm.\n- Blood pressure was 120/80 at noon.\nCall the family on Friday.';
  const at = (q: string) => ({ start: doc.indexOf(q), end: doc.indexOf(q) + q.length, quote: q });
  const errors = [at('50 mg'), at('120/80'), at('Friday')];

  it('a hint shows the line of the mistake without its list marker', () => {
    const spot = slipHintSpot(doc, errors[1]);
    expect(doc.slice(spot.start, spot.end)).toBe('Blood pressure was 120/80 at noon.');
    expect(doc.slice(slipHintSpot(doc, errors[2]).start, slipHintSpot(doc, errors[2]).end)).toBe('Call the family on Friday.');
  });

  it('points at the first mistake the highlights miss and skips the ones already hinted', () => {
    expect(nextSlipHint(errors, [], doc.length, [])).toBe(0);
    const found = [[errors[0].start, errors[0].end]] as [number, number][];
    expect(nextSlipHint(errors, found, doc.length, [])).toBe(1);
    expect(nextSlipHint(errors, found, doc.length, [1])).toBe(2);
    expect(nextSlipHint(errors, found, doc.length, [1, 2])).toBeNull();
  });

  it('each hint takes 10 points off the rep, never below the base', () => {
    expect(REP_POINTS.hint).toBe(10);
    expect(repPoints('daily', 1)).toBe(60);
    expect(repPoints('daily', 1, 1)).toBe(50);
    expect(repPoints('daily', 1, 3)).toBe(30);
    expect(repPoints('daily', 1, 9)).toBe(REP_POINTS.daily.base);
    expect(repPoints('extra', 0.5, 2)).toBe(REP_POINTS.extra.base);
  });
});
