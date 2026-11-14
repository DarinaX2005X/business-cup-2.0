import { describe, expect, it } from 'vitest';
import { categoryReason, exposureOf, explainCategory, observedScore, theoryFromLabels } from '@/domain/evidence';
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

/** Work use published in both sources with per-source facts, as the build writes them. */
const seen = (o: { claude?: [number, number]; api?: [number, number]; theory?: number; work?: number }) =>
  evidence({
    theoryLabel: 'E2',
    theory: o.theory ?? 0.5,
    observed: true,
    aeiShare: o.claude?.[0] ?? o.api?.[0] ?? null,
    aeiSource: o.claude ? 'claude_ai' : '1p_api',
    aeiAutomation: o.claude?.[1] ?? o.api?.[1] ?? null,
    aeiWorkShare: o.work ?? 0.9,
    aeiClaudeShare: o.claude?.[0] ?? null,
    aeiClaudeAutomation: o.claude?.[1] ?? null,
    aeiClaudeWorkShare: o.claude ? o.work ?? 0.9 : null,
    aeiApiShare: o.api?.[0] ?? null,
    aeiApiAutomation: o.api?.[1] ?? null,
    aeiApiWorkShare: o.api ? o.work ?? 0.9 : null,
  });

describe('volume floor: tiny observations do not decide the category', () => {
  it('a share that rounds to 0.00% in both sources is seen rarely, not observed', () => {
    const e = seen({ claude: [0, 0.95], api: [0, 0.99] });
    expect(e).toMatchObject({ observed: false, seenRarely: true, evidenceLevel: 'estimate', category: 'ai_speeds' });
    // E2 plus real but rare usage on information work is enough for ai_speeds.
    expect(explainCategory(e)).toEqual({ key: 'category.explain.seen_rarely_e2', params: { label: 'E2' } });
  });
  it('0.01% of conversations is enough', () => {
    expect(seen({ claude: [0.0001, 0.4] })).toMatchObject({ observed: true, seenRarely: false, evidenceLevel: 'observed' });
  });
  it('a source with mostly personal use does not supply the volume', () => {
    expect(seen({ claude: [0.002, 0.9], work: 0.3 }).observed).toBe(false);
  });
});

describe('categorize: every branch', () => {
  it('no_data without label and observations', () => {
    expect(evidence({ theoryLabel: null, theorySource: null, theory: null }).category).toBe('no_data');
  });
  it('observed with Claude.ai automation >= 0.7 → ai_does, even with a low research rating', () => {
    const e = seen({ claude: [0.001, 0.75], theory: 0 });
    expect(e).toMatchObject({ category: 'ai_does', automationBasis: 'claude_ai' });
    expect(categoryReason(e)).toBe('observed_does');
  });
  it('observed with Claude.ai automation below 0.7 → ai_speeds', () => {
    expect(seen({ claude: [0.001, 0.69], theory: 1 }).category).toBe('ai_speeds');
  });
  it('API-only automation decides only when researchers rate the task E1-level (theory >= 0.75)', () => {
    expect(seen({ api: [0.001, 0.98], theory: 0.5 })).toMatchObject({ category: 'ai_speeds', automationBasis: null });
    const e = seen({ api: [0.001, 0.98], theory: 0.75 });
    expect(e).toMatchObject({ category: 'ai_does', automationBasis: '1p_api' });
    expect(explainCategory(e).key).toBe('category.explain.observed_api');
  });
  it('not observed, E1 level (theory >= 0.75: at least one E1, nothing below E2) → ai_speeds, hands-on or people work included', () => {
    expect(evidence({ theoryLabel: 'E1', theory: 1 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E1', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.75 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E1', theory: 1, physical: true }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E1', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.75, peopleWork: true }).category).toBe('ai_speeds');
  });
  it('not observed, E2 alone (theory 0.5) stays with the person: "AI could help with extra software" is not observed use', () => {
    const e = evidence({ theoryLabel: 'E2', theory: 0.5 });
    expect(e.category).toBe('human_edge');
    expect(explainCategory(e)).toEqual({ key: 'category.explain.estimate_e2_unseen', params: { label: 'E2' } });
    expect(categoryReason(e)).toBe('low_human');
  });
  it('E2 with real but rare usage → ai_speeds, unless the task is hands-on or work with people', () => {
    expect(evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiShare: 0 }).category).toBe('ai_speeds');
    expect(evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiShare: 0, physical: true }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E2', theory: 0.5, observed: true, aeiShare: 0, peopleWork: true }).category).toBe('human_edge');
    expect(categoryReason(evidence({ theoryLabel: 'E2', theory: 0.5, peopleWork: true }))).toBe('people');
    expect(categoryReason(evidence({ theoryLabel: 'E2', theory: 0.5, physical: true }))).toBe('physical');
  });
  it('theory <= 0.25 → human_edge; usage history and penetration are no triggers', () => {
    expect(evidence({ theoryLabel: 'E0', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.25 }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E0', theory: 0, everObserved: true }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E0', theory: 0, penetration: 0.9 }).category).toBe('human_edge');
    expect(evidence({ theoryLabel: 'E0', theory: 0, observed: true, aeiShare: 0 }).category).toBe('human_edge');
  });
  it('a DWA estimate counts as research evidence, not as no_data', () => {
    expect(evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.8 })).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'estimate' });
    expect(evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.6 })).toMatchObject({ category: 'human_edge', evidenceLevel: 'estimate' });
  });
});

describe('explainCategory: one honest sentence per reason', () => {
  it('observed automation and collaboration', () => {
    const auto = seen({ claude: [0.0042, 0.71] });
    expect(explainCategory(auto)).toEqual({ key: 'category.explain.observed_auto', params: { share: '0.42%', auto: '71%', source: 'claude_ai' } });
    const collab = seen({ claude: [0.0003, 0.3] });
    expect(explainCategory(collab)).toEqual({ key: 'category.explain.observed_collab', params: { share: '0.03%', collab: '70%', auto: '30%', source: 'claude_ai' } });
  });
  it('personal use', () => {
    const e = evidence({ theoryLabel: 'E1', theory: 1, aeiShare: 0.0001, aeiSource: 'claude_ai', aeiAutomation: 0.86, aeiWorkShare: 0 });
    expect(explainCategory(e).key).toBe('category.explain.personal_use');
  });
  it('estimates, mixed labels, people, physical and no data', () => {
    expect(explainCategory(evidence({ theoryLabel: 'E1', theory: 1 })).key).toBe('category.explain.estimate_e1');
    expect(explainCategory(evidence({ theoryLabel: 'E2', theory: 0.5 })).key).toBe('category.explain.estimate_e2_unseen');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0 })).key).toBe('category.explain.estimate_e0');
    const mixedHigh = evidence({ theoryLabel: 'E1', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.75 });
    expect(explainCategory(mixedHigh)).toEqual({ key: 'category.explain.estimate_mixed', params: { human: 'E1', gpt4: 'E2', theory: '75%' } });
    const mixedLow = evidence({ theoryLabel: 'E0', gpt4Label: 'E2', theorySource: 'human+gpt4', theory: 0.25 });
    expect(explainCategory(mixedLow)).toEqual({ key: 'category.explain.estimate_low', params: { human: 'E0', gpt4: 'E2', theory: '25%' } });
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: 'estimated', theory: 0.5 })).key).toBe('category.explain.estimate_dwa');
    expect(explainCategory(evidence({ theoryLabel: 'E0', theory: 0, physical: true })).key).toBe('category.explain.physical');
    expect(explainCategory(evidence({ theoryLabel: 'E2', theory: 0.5, peopleWork: true })).key).toBe('category.explain.people');
    expect(explainCategory(evidence({ theoryLabel: null, theorySource: null, theory: null })).key).toBe('category.explain.no_data');
  });
});
