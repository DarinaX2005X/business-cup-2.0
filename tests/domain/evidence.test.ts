import { describe, expect, it } from 'vitest';
import { categorize, exposureOf, explainCategory, observedScore } from '@/domain/evidence';
import { evidence } from './helpers';

describe('exposure indicator (data-sources.md §7)', () => {
  it('combines theory and observed use half and half', () => {
    expect(exposureOf(1, false, null)).toBe(0.5); // E1, not seen in work use: at most 0.5
    expect(exposureOf(1, true, 1)).toBe(1); // E1 and fully automated work use
    expect(exposureOf(0, false, null)).toBe(0); // no evidence either way
    expect(exposureOf(0.5, true, 0.5)).toBeCloseTo(0.25 + 0.375);
  });
  it('observed score is 0.5 + 0.5 × automation, 0.75 when automation is unknown', () => {
    expect(observedScore(false, 0.9)).toBe(0);
    expect(observedScore(true, 0)).toBe(0.5);
    expect(observedScore(true, null)).toBe(0.75);
  });
});

describe('categorize: every branch', () => {
  it('no_data without label and observations', () => {
    expect(evidence({ theoryLabel: null, theorySource: null, theory: null }).category).toBe('no_data');
  });
  it('ai_does: observed, automation >= 0.5, exposure >= 0.75', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiAutomation: 0.5, aeiShare: 0.001, aeiWorkShare: 0.8 });
    expect(e.exposure).toBe(0.875);
    expect(e.category).toBe('ai_does');
    expect(e.evidenceLevel).toBe('observed');
  });
  it('observed but mostly augmentation stays ai_speeds', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiAutomation: 0.4, aeiShare: 0.001, aeiWorkShare: 0.8 });
    expect(e.exposure).toBeGreaterThanOrEqual(0.75);
    expect(e.category).toBe('ai_speeds');
  });
  it('observed with high automation but exposure below 0.75 is ai_speeds', () => {
    const e = evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiAutomation: 0.6, aeiShare: 0.001, aeiWorkShare: 0.8 });
    expect(e.exposure).toBeCloseTo(0.65);
    expect(e.category).toBe('ai_speeds');
  });
  it('physical task without observations is human_edge even with an E1 label', () => {
    expect(evidence({ theoryLabel: 'E1', theory: 1, physical: true }).category).toBe('human_edge');
  });
  it('physical task that is observed follows exposure', () => {
    expect(categorize({ theorySource: 'human', observed: true, aeiAutomation: 0.9, exposure: 0.73, physical: true })).toBe('ai_speeds');
  });
  it('exposure below 0.25 is human_edge, 0.25 is ai_speeds', () => {
    expect(evidence({ theoryLabel: 'E0', theory: 0 }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E2', theory: 0.5 }).category).toBe('ai_speeds');
  });
  it('a DWA estimate counts as research evidence, not as no_data', () => {
    const e = evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.6 });
    expect(e.category).toBe('ai_speeds');
    expect(e.evidenceLevel).toBe('estimate');
  });
});

describe('explainCategory', () => {
  it('observed automation quotes share and automation', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiShare: 0.0042, aeiSource: 'claude_ai', aeiAutomation: 0.71, aeiWorkShare: 0.9 });
    expect(explainCategory(e)).toEqual({ key: 'category.explain.observed_auto', params: { share: '0.42%', auto: '71%', source: 'claude_ai' } });
  });
  it('observed collaboration quotes the augmentation share', () => {
    const e = evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiShare: 0.00001, aeiSource: '1p_api', aeiAutomation: 0.3, aeiWorkShare: 0.9 });
    expect(explainCategory(e)).toEqual({ key: 'category.explain.observed_collab', params: { share: '<0.01%', collab: '70%', source: '1p_api' } });
  });
  it('published but personal use is explained as such', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, observed: false, aeiShare: 0.0001, aeiSource: 'claude_ai', aeiAutomation: 0.86, aeiWorkShare: 0 });
    expect(explainCategory(e).key).toBe('category.explain.personal_use');
  });
  it('estimates, physical and no data', () => {
    expect(explainCategory(evidence({ theoryLabel: 'E1', theory: 1 })).key).toBe('category.explain.estimate_e1');
    expect(explainCategory(evidence({ theoryLabel: 'E2', theory: 0.5 })).key).toBe('category.explain.estimate_e2');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0 })).key).toBe('category.explain.estimate_e0');
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.5 })).key).toBe('category.explain.estimate_dwa');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0, physical: true })).key).toBe('category.explain.physical');
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: null, theory: null })).key).toBe('category.explain.no_data');
  });
});
