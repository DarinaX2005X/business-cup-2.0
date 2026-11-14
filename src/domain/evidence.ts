import { CATEGORY_THRESHOLDS, THEORY_BY_LABEL, THEORY_WEIGHT, WORK_GATE } from './constants';
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

type CategoryInput = Pick<TaskEvidence, 'theorySource' | 'theory' | 'observed' | 'aeiAutomation' | 'physical'> &
  Partial<Pick<TaskEvidence, 'aeiClaudeShare' | 'aeiApiShare' | 'aeiClaudeAutomation' | 'aeiApiAutomation' | 'aeiClaudeWorkShare' | 'aeiApiWorkShare' | 'peopleWork' | 'seenRarely'>>;

/** A source counts when its share is at least 0.01% and most of its use is work (missing work share: assumed). */
function meaningful(share: number | null | undefined, work: number | null | undefined): boolean {
  return (share ?? 0) >= CATEGORY_THRESHOLDS.minObservedShare && (work == null || work >= WORK_GATE);
}

/**
 * Automation share that may decide ai_does, and where it comes from. Claude.ai traffic is people doing their
 * own work; the first-party API is mostly programmatic pipelines (median automation 0.98 against 0.66 on
 * Claude.ai), so API automation alone counts only when the research rating also says an LLM alone can do the
 * task (theory >= 0.75). Without per-source fields (older fixtures) the pooled automation is used.
 */
export function automationBasis(e: CategoryInput): { automation: number | null; basis: 'claude_ai' | '1p_api' | null } {
  const t = CATEGORY_THRESHOLDS;
  if (!e.observed) return { automation: null, basis: null };
  if (e.aeiClaudeShare === undefined && e.aeiApiShare === undefined) return { automation: e.aeiAutomation, basis: 'claude_ai' };
  if (meaningful(e.aeiClaudeShare, e.aeiClaudeWorkShare) && e.aeiClaudeAutomation != null) return { automation: e.aeiClaudeAutomation, basis: 'claude_ai' };
  if (meaningful(e.aeiApiShare, e.aeiApiWorkShare) && e.aeiApiAutomation != null && e.theory >= t.aiDoesApiTheory) {
    return { automation: e.aeiApiAutomation, basis: '1p_api' };
  }
  return { automation: null, basis: null };
}

/** Why an unobserved task stays with the person, if it does: hands-on work or work with people. */
function humanReason(e: CategoryInput): 'physical' | 'people' | null {
  if (e.observed || e.theory >= CATEGORY_THRESHOLDS.unobservedSpeedsTheory) return null;
  if (e.physical === true) return 'physical';
  if (e.peopleWork === true) return 'people';
  return null;
}

/**
 * Unobserved task (no meaningful work use, possibly seen rarely): does the research rating alone make it
 * ai_speeds? At least one E1 and nothing below E2 (theory >= 0.75): yes. E2 level (0.5): only with real but
 * rare usage on a task that is neither hands-on nor work with people. Lower: no.
 */
function unobservedSpeeds(e: CategoryInput): boolean {
  const t = CATEGORY_THRESHOLDS;
  if (e.theory >= t.unobservedSpeedsTheory) return true;
  if (e.theory >= t.e2Theory) return e.seenRarely === true && e.physical !== true && e.peopleWork !== true;
  return false;
}

/**
 * Category of a task.
 * - no_data: no research label (human, GPT-4 or DWA estimate) and no meaningful observation.
 * - Observed (AEI 2026-06-26 work use with a share >= 0.01% of a source's conversations; smaller shares round
 *   to 0.00% in the published data and are only `seenRarely`): automation >= 0.7 measured on Claude.ai (or on
 *   the API when theory >= 0.75) → ai_does; any other meaningful observation → ai_speeds.
 * - Not observed (or seen rarely): research theory >= 0.75 (at least one rater E1, nothing below E2) →
 *   ai_speeds; theory 0.5 (E2: an LLM could help once extra software exists) → ai_speeds only when real but rare
 *   usage backs it up (seenRarely) and the task is neither hands-on (Microsoft physical flag) nor work with
 *   people (most O*NET activities interpersonal: care, teaching, supervising, negotiating …); otherwise
 *   human_edge, "stays with you for now"; theory <= 0.25 → human_edge.
 * Anthropic's task_penetration (β > 0 and enough work use in the Aug and Nov 2025 samples, automated use
 * weighted fully and augmentative use half; Massenkoff and McCrory, "Labor market impacts", 2026) and older
 * releases (everObserved) are shown as supporting facts, never used as triggers.
 */
export function categorize(e: CategoryInput): Category {
  const t = CATEGORY_THRESHOLDS;
  if (e.theorySource === null && !e.observed) return 'no_data';
  if (e.observed) {
    const { automation } = automationBasis(e);
    return automation !== null && automation >= t.aiDoesAutomation ? 'ai_does' : 'ai_speeds';
  }
  return unobservedSpeeds(e) ? 'ai_speeds' : 'human_edge';
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
  /** Work use published in AEI 2026-06-26 (work share >= WORK_GATE), before the volume floor. */
  observed: boolean;
  everObserved: boolean;
  aeiShare: number | null;
  aeiSource: TaskEvidence['aeiSource'];
  aeiAutomation: number | null;
  aeiWorkShare: number | null;
  penetration: number | null;
  history: TaskEvidence['history'];
  physical: boolean | null;
  aeiClaudeShare?: number | null;
  aeiApiShare?: number | null;
  aeiClaudeAutomation?: number | null;
  aeiApiAutomation?: number | null;
  aeiClaudeWorkShare?: number | null;
  aeiApiWorkShare?: number | null;
  peopleWork?: boolean;
}

/**
 * Assemble the full evidence record of one task: the volume floor turns published-but-tiny work use into
 * `seenRarely`, then exposure, category and evidence level follow.
 */
export function buildEvidence(input: EvidenceInput): TaskEvidence {
  const theory = input.theory ?? 0;
  const theorySource = input.theory === null ? null : input.theorySource;
  const perSource = input.aeiClaudeShare !== undefined || input.aeiApiShare !== undefined;
  const meaningfulUse = perSource
    ? meaningful(input.aeiClaudeShare, input.aeiClaudeWorkShare) || meaningful(input.aeiApiShare, input.aeiApiWorkShare)
    : (input.aeiShare ?? 0) >= CATEGORY_THRESHOLDS.minObservedShare;
  const observed = input.observed && meaningfulUse;
  const seenRarely = input.observed && !observed;
  const draft = {
    ...input,
    theory: round4(theory),
    theorySource,
    observed,
    // Per-source facts stay undefined for inputs that only carry pooled values (tests, older fixtures).
    ...(perSource
      ? {
          aeiClaudeShare: input.aeiClaudeShare ?? null,
          aeiApiShare: input.aeiApiShare ?? null,
          aeiClaudeAutomation: input.aeiClaudeAutomation ?? null,
          aeiApiAutomation: input.aeiApiAutomation ?? null,
          aeiClaudeWorkShare: input.aeiClaudeWorkShare ?? null,
          aeiApiWorkShare: input.aeiApiWorkShare ?? null,
        }
      : {}),
    peopleWork: input.peopleWork ?? false,
  };
  const { basis } = automationBasis(draft);
  const exposure = round4(exposureOf(theory, observed, input.aeiAutomation));
  const base = { ...draft, seenRarely, automationBasis: basis, exposure };
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
  // Added in the data repair round
  'category.explain.observed_api',
  'category.explain.seen_rarely',
  'category.explain.people',
  'category.explain.estimate_low',
  // Added in the final category repair
  'category.explain.estimate_e2_unseen',
  'category.explain.seen_rarely_e2',
] as const;
export type ExplainKey = (typeof EXPLAIN_KEYS)[number];

/**
 * One honest sentence for the category, matching the reason categorize() used. Params are pre-formatted
 * strings. Keys:
 * - observed_auto { share, auto, source }: seen in real work use, mostly handed to AI whole (ai_does);
 * - observed_api { share, auto }: API traffic automates it and researchers rate it LLM-doable (ai_does);
 * - observed_collab { share, collab, auto, source }: seen in real work use, mostly as collaboration (ai_speeds);
 * - seen_rarely { label }: work use published but below 0.01% of conversations, so the research rating decides;
 * - personal_use { work, label }: published, but mostly personal or coursework use;
 * - physical / people: hands-on work or work with people, not seen in usage (human_edge);
 * - estimate_e1 / estimate_e2 / estimate_mixed { human, gpt4, theory } / estimate_dwa { theory }: research
 *   rating decides (ai_speeds);
 * - estimate_low { human, gpt4, theory } / estimate_e0: researchers rate LLM help low (human_edge);
 * - no_data. earlier_use and penetration are kept for existing dictionaries and no longer returned.
 */
export function explainCategory(e: TaskEvidence): { key: ExplainKey; params: Record<string, string> } {
  if (e.observed) {
    const share = formatShare(Math.max(e.aeiClaudeShare ?? 0, e.aeiApiShare ?? 0) || e.aeiShare);
    const { automation, basis } = automationBasis(e);
    const auto = automation ?? e.aeiAutomation ?? 0.5;
    const source = basis ?? e.aeiSource ?? 'claude_ai';
    if (e.category === 'ai_does' && basis === '1p_api') return { key: 'category.explain.observed_api', params: { share, auto: pct(auto) } };
    if (e.category === 'ai_does') return { key: 'category.explain.observed_auto', params: { share, auto: pct(auto), source } };
    return { key: 'category.explain.observed_collab', params: { share, collab: pct(1 - auto), auto: pct(auto), source } };
  }
  if (e.theorySource === null) return { key: 'category.explain.no_data', params: {} };
  const reason = humanReason(e);
  if (e.category === 'human_edge' && reason === 'physical') return { key: 'category.explain.physical', params: {} };
  if (e.category === 'human_edge' && reason === 'people') return { key: 'category.explain.people', params: {} };
  const label = e.theoryLabel ?? e.gpt4Label ?? '';
  if (e.seenRarely && e.category === 'ai_speeds' && e.theory < CATEGORY_THRESHOLDS.unobservedSpeedsTheory) {
    return { key: 'category.explain.seen_rarely_e2', params: { label } };
  }
  if (e.seenRarely) return { key: 'category.explain.seen_rarely', params: { label } };
  if (e.aeiShare !== null && e.aeiWorkShare !== null) {
    // Published in AEI, but most of that use is personal or coursework, so it does not count as work use.
    return { key: 'category.explain.personal_use', params: { work: pct(e.aeiWorkShare), label } };
  }
  if (e.theorySource === 'estimated') return { key: 'category.explain.estimate_dwa', params: { theory: pct(e.theory) } };
  const mixed = { human: e.theoryLabel ?? '', gpt4: e.gpt4Label ?? '', theory: pct(e.theory) };
  if (e.category === 'human_edge') {
    // E2 alone says AI could help once extra software exists; with no use observed it stays with the person for now.
    if (e.theory >= CATEGORY_THRESHOLDS.e2Theory) return { key: 'category.explain.estimate_e2_unseen', params: { label } };
    if (e.theorySource === 'human+gpt4') return { key: 'category.explain.estimate_low', params: mixed };
    return { key: 'category.explain.estimate_e0', params: {} };
  }
  if (e.theorySource === 'human+gpt4') return { key: 'category.explain.estimate_mixed', params: mixed };
  if (label === 'E1') return { key: 'category.explain.estimate_e1', params: {} };
  return { key: 'category.explain.estimate_e2', params: {} };
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

export type CategoryReason = 'observed_does' | 'observed_speeds' | 'physical' | 'people' | 'rated_speeds' | 'low_human' | 'no_data';

/** Which rule of categorize() decided the task (for /method and the inspector). */
export function categoryReason(e: CategoryInput): CategoryReason {
  const category = categorize(e);
  if (category === 'no_data') return 'no_data';
  if (e.observed) return category === 'ai_does' ? 'observed_does' : 'observed_speeds';
  const human = humanReason(e);
  if (human) return human;
  return category === 'ai_speeds' ? 'rated_speeds' : 'low_human';
}
