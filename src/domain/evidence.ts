import { CATEGORY_THRESHOLDS, THEORY_BY_LABEL, THEORY_WEIGHT } from './constants';
import type { Category, EvidenceLevel, TaskEvidence } from './types';

type Label = 'E0' | 'E1' | 'E2';

/** Observed half of the indicator: 0 when not observed, else 0.5 + 0.5 × automation share (0.5 when unknown). */
export function observedScore(observed: boolean, aeiAutomation: number | null): number {
  if (!observed) return 0;
  return 0.5 + 0.5 * (aeiAutomation ?? 0.5);
}

/** exposure = THEORY_WEIGHT × theory + (1 − THEORY_WEIGHT) × observedScore, in [0, 1]. */
export function exposureOf(theory: number, observed: boolean, aeiAutomation: number | null): number {
  return THEORY_WEIGHT * theory + (1 - THEORY_WEIGHT) * observedScore(observed, aeiAutomation);
}

export function theoryOfLabel(label: Label): number {
  return THEORY_BY_LABEL[label];
}

/**
 * Research theory of a task from the GPTs-are-GPTs labels: both labels agree (or only one exists) → that label;
 * human and GPT-4 disagree → their mean (e.g. E0 + E2 → 0.25), source 'human+gpt4'.
 */
export function theoryFromLabels(human: Label | null, gpt4: Label | null): { theory: number; source: 'human' | 'gpt4' | 'human+gpt4' } | null {
  if (human && gpt4 && human !== gpt4) return { theory: (theoryOfLabel(human) + theoryOfLabel(gpt4)) / 2, source: 'human+gpt4' };
  if (human) return { theory: theoryOfLabel(human), source: 'human' };
  if (gpt4) return { theory: theoryOfLabel(gpt4), source: 'gpt4' };
  return null;
}

type CategoryInput = Pick<TaskEvidence, 'theorySource' | 'theory' | 'observed' | 'everObserved' | 'penetration' | 'aeiAutomation' | 'physical'>;

/** Any sign of real AI use beyond the work-gated latest release. */
function otherUsage(e: Pick<TaskEvidence, 'everObserved' | 'penetration'>): boolean {
  return e.everObserved || (e.penetration ?? 0) > 0;
}

/** The Microsoft physical flag decides only when nothing else says the task is done with AI. */
function physicalWins(e: CategoryInput): boolean {
  return e.physical === true && !e.observed && !otherUsage(e) && e.theory <= CATEGORY_THRESHOLDS.physicalMaxTheory;
}

/**
 * Category of a task. Observed real use wins over the research label:
 * - no_data: no research label (human, GPT-4 or DWA estimate) and not observed;
 * - observed (work-gated AEI 2026-06-26): automation share >= 0.6 → ai_does, otherwise ai_speeds;
 * - physical task (Microsoft) without any usage signal and theory <= 0.5 → human_edge;
 * - theory >= 0.25, or ever observed since Aug 2025, or Anthropic task_penetration > 0 → ai_speeds;
 * - otherwise human_edge.
 */
export function categorize(e: CategoryInput): Category {
  const t = CATEGORY_THRESHOLDS;
  if (e.theorySource === null && !e.observed) return 'no_data';
  if (e.observed) return (e.aeiAutomation ?? 0.5) >= t.aiDoesAutomation ? 'ai_does' : 'ai_speeds';
  if (physicalWins(e)) return 'human_edge';
  if (e.theory >= t.aiSpeedsTheory || otherUsage(e)) return 'ai_speeds';
  return 'human_edge';
}

export function evidenceLevelOf(e: Pick<TaskEvidence, 'observed' | 'theorySource'>): EvidenceLevel {
  if (e.observed) return 'observed';
  if (e.theorySource !== null) return 'estimate';
  return 'none';
}

export interface EvidenceInput {
  theoryLabel: TaskEvidence['theoryLabel'];
  gpt4Label: TaskEvidence['gpt4Label'];
  theorySource: TaskEvidence['theorySource'];
  theory: number | null; // label value, mean of disagreeing labels, or DWA mean; null when nothing is known
  observed: boolean;
  everObserved: boolean;
  aeiShare: number | null;
  aeiSource: TaskEvidence['aeiSource'];
  aeiAutomation: number | null;
  aeiWorkShare: number | null;
  penetration: number | null;
  history: TaskEvidence['history'];
  physical: boolean | null;
}

/** Assemble the full evidence record of one task: exposure, category, evidence level. */
export function buildEvidence(input: EvidenceInput): TaskEvidence {
  const theory = input.theory ?? 0;
  const theorySource = input.theory === null ? null : input.theorySource;
  const exposure = round4(exposureOf(theory, input.observed, input.aeiAutomation));
  const base = { ...input, theory: round4(theory), theorySource, exposure };
  return { ...base, category: categorize(base), evidenceLevel: evidenceLevelOf(base) };
}

export const EXPLAIN_KEYS = [
  'category.explain.observed_auto',
  'category.explain.observed_collab',
  'category.explain.personal_use',
  'category.explain.earlier_use',
  'category.explain.penetration',
  'category.explain.estimate_e1',
  'category.explain.estimate_e2',
  'category.explain.estimate_e0',
  'category.explain.estimate_mixed',
  'category.explain.estimate_dwa',
  'category.explain.physical',
  'category.explain.no_data',
] as const;
export type ExplainKey = (typeof EXPLAIN_KEYS)[number];

/**
 * One sentence of evidence for the UI dictionary, matching the reason categorize() used. Params are
 * pre-formatted strings, e.g. observed_auto { share: '0.42%', auto: '71%', source: 'claude_ai' } → "Seen in real
 * AI use: 71% of these conversations hand the whole task to AI".
 */
export function explainCategory(e: TaskEvidence): { key: ExplainKey; params: Record<string, string> } {
  if (e.observed) {
    const auto = e.aeiAutomation ?? 0.5;
    const share = formatShare(e.aeiShare);
    const source = e.aeiSource ?? 'claude_ai';
    if (e.category === 'ai_does') return { key: 'category.explain.observed_auto', params: { share, auto: pct(auto), source } };
    return { key: 'category.explain.observed_collab', params: { share, collab: pct(1 - auto), auto: pct(auto), source } };
  }
  if (e.category === 'human_edge' && physicalWins(e)) return { key: 'category.explain.physical', params: {} };
  if (e.aeiShare !== null && e.aeiWorkShare !== null) {
    // Published in AEI, but most of that use is personal or coursework, so it does not count as work use.
    return { key: 'category.explain.personal_use', params: { work: pct(e.aeiWorkShare), label: e.theoryLabel ?? '' } };
  }
  if (e.category === 'ai_speeds' && e.theory < CATEGORY_THRESHOLDS.aiSpeedsTheory) {
    if (e.everObserved) return { key: 'category.explain.earlier_use', params: {} };
    return { key: 'category.explain.penetration', params: { penetration: pct(e.penetration ?? 0) } };
  }
  if (e.theorySource === 'estimated') return { key: 'category.explain.estimate_dwa', params: { theory: pct(e.theory) } };
  if (e.theorySource === 'human+gpt4') {
    return { key: 'category.explain.estimate_mixed', params: { human: e.theoryLabel ?? '', gpt4: e.gpt4Label ?? '', theory: pct(e.theory) } };
  }
  const label = e.theoryLabel ?? e.gpt4Label;
  if (label === 'E1') return { key: 'category.explain.estimate_e1', params: {} };
  if (label === 'E2') return { key: 'category.explain.estimate_e2', params: {} };
  if (label === 'E0') return { key: 'category.explain.estimate_e0', params: {} };
  return { key: 'category.explain.no_data', params: {} };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** AEI shares are tiny fractions of all conversations: 0.0042 → '0.42%', below 0.01% → '<0.01%'. */
export function formatShare(share: number | null): string {
  if (share === null) return '';
  const p = share * 100;
  if (p < 0.01) return '<0.01%';
  return `${p.toFixed(2)}%`;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
