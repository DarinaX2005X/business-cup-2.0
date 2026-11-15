import { describe, expect, it } from 'vitest';
import { trapSpots, type TrapFull } from '@/domain/reps';

describe('Delegate trap spots', () => {
  const inputs = 'Recipe for the bake sale: 12 cups of flour. Oven at 180 C for 0:40. Note from Sam: the oven at school only reaches 160 C.';
  const run = 'Bake the 12 cups of flour mix at 180 C for 40 minutes. The school oven runs at 180 C, so the timing works.';
  const trap = {
    id: 'oven',
    description: 'The school oven only reaches 160 C, so 180 C is impossible.',
    keywords: ['40', '12 cups', '180 C', 'school oven'],
    evidence: ['Oven at 180 C for 0:40', 'the oven at school only reaches 160 C'],
  } as unknown as TrapFull;

  it('marks the evidence quotes in the inputs, not stray numbers', () => {
    const spots = trapSpots([trap], inputs, run).filter((s) => s.where === 'inputs');
    expect(spots.map((s) => inputs.slice(s.start, s.end))).toEqual(['Oven at 180 C for 0:40', 'the oven at school only reaches 160 C']);
  });

  it('gives the AI result one spot per trap, on a real phrase', () => {
    const spots = trapSpots([trap], inputs, run).filter((s) => s.where === 'run');
    expect(spots).toHaveLength(1);
    expect(run.slice(spots[0].start, spots[0].end)).toBe('school oven');
  });
});
