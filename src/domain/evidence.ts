import { CATEGORY_THRESHOLDS, THEORY_BY_LABEL, THEORY_WEIGHT } from './constants';
import type { Category, EvidenceLevel, TaskEvidence } from './types';

/** Observed half of the indicator: 0 when not observed, else 0.5 + 0.5 × automation share (0.5 when unknown). */
export function observedScore(observed: boolean, aeiAutomation: number | null): number {
  if (!observed) return 0;
  return 0.5 + 0.5 * (aeiAutomation ?? 0.5);
}

/** exposure = THEORY_WEIGHT × theory + (1 − THEORY_WEIGHT) × observedScore, in [0, 1]. */
export function exposureOf(theory: number, observed: boolean, aeiAutomation: number | null): number {
  return THEORY_WEIGHT * theory + (1 - THEORY_WEIGHT) * observedScore(observed, aeiAutomation);
}

export function theoryOfLabel(label: 'E0' | 'E1' | 'E2'): number {
  return THEORY_BY_LABEL[label];
}

type CategoryInput = Pick<TaskEvidence, 'theorySource' | 'observed' | 'aeiAutomation' | 'exposure' | 'physical'>;

/**
 * PLAN «Категория задачи»:
 * - no_data: no research label (human, GPT-4 or DWA estimate) and not observed;
 * - ai_does: observed, automation share >= 0.5 and exposure >= 0.75;
 * - human_edge: exposure < 0.25, or a physical task without observations;
 * - ai_speeds: everything else (exposure >= 0.25).
 */
export function categorize(e: CategoryInput): Category {
  const t = CATEGORY_THRESHOLDS;
  if (e.theorySource === null && !e.observed) return 'no_data';
  if (e.observed && (e.aeiAutomation ?? 0) >= t.aiDoesAutomation && e.exposure >= t.aiDoesExposure) return 'ai_does';
  if (e.physical === true && !e.observed) return 'human_edge';
  if (e.exposure < t.aiSpeedsExposure) return 'human_edge';
  return 'ai_speeds';
}

export function evidenceLevelOf(e: Pick<TaskEvidence, 'observed' | 'theorySource'>): EvidenceLevel {
  if (e.observed) return 'observed';
  if (e.theorySource !== null) return 'estimate';
  return 'none';
}

export interface EvidenceInput {
  theoryLabel: TaskEvidence['theoryLabel'];
  theorySource: TaskEvidence['theorySource'];
  theory: number | null; // DWA mean when estimated; null when nothing is known
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
  'category.explain.estimate_e1',
  'category.explain.estimate_e2',
  'category.explain.estimate_e0',
  'category.explain.estimate_dwa',
  'category.explain.physical',
  'category.explain.no_data',
] as const;
export type ExplainKey = (typeof EXPLAIN_KEYS)[number];

/**
 * One sentence of evidence for the UI dictionary. Params are pre-formatted strings, e.g.
 * observed_auto { share: '0.42%', auto: '71%', source: 'claude_ai' } → "Seen in real AI use: 71% of these
 * conversations hand the whole task to AI". The source key lets the dictionary say "Claude conversations"
 * or "API traffic".
 */
export function explainCategory(e: TaskEvidence): { key: ExplainKey; params: Record<string, string> } {
  if (e.observed) {
    const auto = e.aeiAutomation ?? 0.5;
    const share = formatShare(e.aeiShare);
    const source = e.aeiSource ?? 'claude_ai';
    if (auto >= 0.5) return { key: 'category.explain.observed_auto', params: { share, auto: pct(auto), source } };
    return { key: 'category.explain.observed_collab', params: { share, collab: pct(1 - auto), source } };
  }
  if (e.physical === true) return { key: 'category.explain.physical', params: {} };
  if (e.aeiShare !== null && e.aeiWorkShare !== null) {
    // Published in AEI, but most of that use is personal or coursework, so it does not count as work use.
    return { key: 'category.explain.personal_use', params: { work: pct(e.aeiWorkShare), label: e.theoryLabel ?? '' } };
  }
  if (e.theorySource === 'estimated') return { key: 'category.explain.estimate_dwa', params: { theory: pct(e.theory) } };
  if (e.theoryLabel === 'E1') return { key: 'category.explain.estimate_e1', params: {} };
  if (e.theoryLabel === 'E2') return { key: 'category.explain.estimate_e2', params: {} };
  if (e.theoryLabel === 'E0') return { key: 'category.explain.estimate_e0', params: {} };
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
