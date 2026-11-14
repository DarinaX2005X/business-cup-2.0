import { describe, expect, it } from 'vitest';
import { exposureOf, explainCategory, observedScore, theoryFromLabels } from '@/domain/evidence';
import { evidence } from './helpers';

describe('exposure indicator (data-sources.md §7)', () => {
  it('combines theory and observed use half and half', () => {
    expect(exposureOf(1, false, null)).toBe(0.5);
    expect(exposureOf(1, true, 1)).toBe(1);
    expect(exposureOf(0, false, null)).toBe(0);
    expect(exposureOf(0.5, true, 0.5)).toBeCloseTo(0.25 + 0.375);
  });
  it('observed score is 0.5 + 0.5 × automation, 0.75 when automation is unknown', () => {
    expect(observedScore(false, 0.9)).toBe(0);
    expect(observedScore(true, 0)).toBe(0.5);
    expect(observedScore(true, null)).toBe(0.75);
  });
});

describe('theory from GPTs-are-GPTs labels', () => {
  it('uses the agreed label, the only label, or the mean when human and GPT-4 disagree', () => {
    expect(theoryFromLabels('E1', 'E1')).toEqual({ theory: 1, source: 'human' });
    expect(theoryFromLabels('E2', null)).toEqual({ theory: 0.5, source: 'human' });
    expect(theoryFromLabels(null, 'E1')).toEqual({ theory: 1, source: 'gpt4' });
    expect(theoryFromLabels('E0', 'E2')).toEqual({ theory: 0.25, source: 'human+gpt4' });
    expect(theoryFromLabels('E0', 'E1')).toEqual({ theory: 0.5, source: 'human+gpt4' });
    expect(theoryFromLabels(null, null)).toBeNull();
  });
});

describe('categorize: every branch', () => {
  it('no_data without label and observations', () => {
    expect(evidence({ theoryLabel: null, theorySource: null, theory: null }).category).toBe('no_data');
  });
  it('observed use wins over the label: automation >= 0.6 → ai_does, even with E0', () => {
    const e = evidence({ theoryLabel: 'E0', theory: 0, observed: true, aeiAutomation: 0.86, aeiShare: 0.001, aeiWorkShare: 0.8 });
    expect(e).toMatchObject({ category: 'ai_does', evidenceLevel: 'observed' });
  });
  it('observed with automation below 0.6 → ai_speeds, even with E1', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiAutomation: 0.59, aeiShare: 0.001, aeiWorkShare: 0.8 });
    expect(e.category).toBe('ai_speeds');
  });
  it('physical flag decides only without other usage signals and with theory <= 0.5', () => {
    expect(evidence({ theoryLabel: 'E2', theory: 0.5, physical: true }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E1', theory: 1, physical: true }).category).toBe('ai_speeds'); // E1 overrides the flag
    expect(evidence({ theoryLabel: 'E0', theory: 0, physical: true, penetration: 0.78 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E0', theory: 0, physical: true, everObserved: true }).category).toBe('ai_speeds');
  });
  it('not observed: theory >= 0.25, ever observed or penetration > 0 → ai_speeds; otherwise human_edge', () => {
    expect(evidence({ theoryLabel: 'E2', theory: 0.5 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E0', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.25 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E0', theory: 0, everObserved: true }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E0', theory: 0, penetration: 0.1 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E0', theory: 0, penetration: 0 }).category).toBe('human_edge');
  });
  it('a DWA estimate counts as research evidence, not as no_data', () => {
    const e = evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.6 });
    expect(e).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'estimate' });
  });
});

describe('explainCategory follows the reason of the category', () => {
  it('observed automation and collaboration', () => {
    const auto = evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiShare: 0.0042, aeiSource: 'claude_ai', aeiAutomation: 0.71, aeiWorkShare: 0.9 });
    expect(explainCategory(auto)).toEqual({ key: 'category.explain.observed_auto', params: { share: '0.42%', auto: '71%', source: 'claude_ai' } });
    const collab = evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiShare: 0.00001, aeiSource: '1p_api', aeiAutomation: 0.3, aeiWorkShare: 0.9 });
    expect(explainCategory(collab)).toEqual({ key: 'category.explain.observed_collab', params: { share: '<0.01%', collab: '70%', auto: '30%', source: '1p_api' } });
  });
  it('personal use, earlier releases and penetration', () => {
    expect(explainCategory(evidence({ theoryLabel: 'E1', theory: 1, aeiShare: 0.0001, aeiSource: 'claude_ai', aeiAutomation: 0.86, aeiWorkShare: 0 })).key).toBe('category.explain.personal_use');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0, everObserved: true })).key).toBe('category.explain.earlier_use');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0, penetration: 0.4 }))).toEqual({ key: 'category.explain.penetration', params: { penetration: '40%' } });
  });
  it('estimates, mixed labels, physical and no data', () => {
    expect(explainCategory(evidence({ theoryLabel: 'E1', theory: 1 })).key).toBe('category.explain.estimate_e1');
    expect(explainCategory(evidence({ theoryLabel: 'E2', theory: 0.5 })).key).toBe('category.explain.estimate_e2');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0 })).key).toBe('category.explain.estimate_e0');
    expect(explainCategory(evidence({ theoryLabel: 'E0', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.25 }))).toEqual({
      key: 'category.explain.estimate_mixed',
      params: { human: 'E0', gpt4: 'E2', theory: '25%' },
    });
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.5 })).key).toBe('category.explain.estimate_dwa');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0, physical: true })).key).toBe('category.explain.physical');
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: null, theory: null })).key).toBe('category.explain.no_data');
  });
});
