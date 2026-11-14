// Formula constants. /method and meta.json quote these values; change them only here.
// Source of the indicator: research/data-sources.md §7 (ported from research/probe/exposure_index.py).

/** Weight of the research label in exposure; the observed half gets 1 − THEORY_WEIGHT. Our modelling choice. */
export const THEORY_WEIGHT = 0.5;

/** AEI task counts as observed work use when use_case_work_pct >= 50% in either source (claude_ai or API). */
export const WORK_GATE = 0.5;

/** AEI pct is rounded to 2 decimals (≈55% of rows read 0.00), so pct-weighted averages floor it at 0.005 (percent). */
export const AEI_PCT_FLOOR = 0.005;

/** Eloundou et al. β convention: E1 = 1, E2 = 0.5, E0 = 0. */
export const THEORY_BY_LABEL = { E0: 0, E1: 1, E2: 0.5 } as const;

/**
 * Category rules (data repair round, see evidence.ts categorize for the full reasoning):
 * - observed = AEI 2026-06-26 work use (>= WORK_GATE) with a share of at least minObservedShare in Claude.ai or
 *   the API; work use below that floor is `seenRarely` and is categorised like an unobserved task;
 * - observed: Claude.ai automation >= aiDoesAutomation → ai_does; API-only automation counts only when the
 *   research rating also says an LLM alone can do it (theory >= aiDoesApiTheory); otherwise ai_speeds;
 * - not observed: physical (Microsoft) with theory <= physicalMaxTheory, or people work (O*NET interpersonal
 *   activities) with theory <= peopleMaxTheory → human_edge; theory >= unobservedSpeedsTheory → ai_speeds;
 *   otherwise human_edge;
 * - no label and no observation → no_data. task_penetration and everObserved are shown, never used as triggers.
 */
export const CATEGORY_THRESHOLDS = {
  aiDoesAutomation: 0.7,
  /**
   * AEI publishes pct with 2 decimals; 0.01% of a source's conversations is the smallest non-zero value. A task
   * whose share rounds to 0.00% in both sources (59% of work-gated tasks) is "seen rarely", not observed.
   */
  minObservedShare: 0.0001,
  /** API traffic is mostly programmatic (median automation 0.98 vs 0.66 on Claude.ai): API-only ai_does needs this theory. */
  aiDoesApiTheory: 0.75,
  /** Unobserved tasks need this research theory (E2 agreed by both raters, or better) to count as ai_speeds. */
  unobservedSpeedsTheory: 0.5,
  /** People work stays with the person when unobserved and theory is at most this (one rater E1, the other E2). */
  peopleMaxTheory: 0.75,
  /** A task is people work when at least this share of its DWAs belong to the interpersonal GWAs below. */
  peopleWorkShare: 0.5,
  /** @deprecated replaced by unobservedSpeedsTheory; kept for existing imports */
  aiSpeedsTheory: 0.25,
  /** Hands-on work stays human only when researchers see little LLM help (E0, or E0 by one rater and E2 by the other). */
  physicalMaxTheory: 0.25,
  /** @deprecated categories no longer use exposure thresholds; kept for existing imports */
  aiDoesExposure: 0.75,
  /** @deprecated categories no longer use exposure thresholds; kept for existing imports */
  aiSpeedsExposure: 0.25,
} as const;

/**
 * O*NET 31.0 Generalized Work Activities that are work with people: relationships, caring, influencing,
 * negotiating, working with the public, coordinating, team building, teaching, supervising, coaching,
 * consulting and staffing. Used for `peopleWork` (Task → DWA → GWA).
 */
export const PEOPLE_GWAS: Record<string, string> = {
  '4.A.4.a.4': 'Establishing and Maintaining Interpersonal Relationships',
  '4.A.4.a.5': 'Assisting and Caring for Others',
  '4.A.4.a.6': 'Selling or Influencing Others',
  '4.A.4.a.7': 'Resolving Conflicts and Negotiating with Others',
  '4.A.4.a.8': 'Performing for or Working Directly with the Public',
  '4.A.4.b.1': 'Coordinating the Work and Activities of Others',
  '4.A.4.b.2': 'Developing and Building Teams',
  '4.A.4.b.3': 'Training and Teaching Others',
  '4.A.4.b.4': 'Guiding, Directing, and Motivating Subordinates',
  '4.A.4.b.5': 'Coaching and Developing Others',
  '4.A.4.b.6': 'Providing Consultation and Advice to Others',
  '4.A.4.c.2': 'Staffing Organizational Units',
};

/** @deprecated pay at stake now uses category weights (PAY_WEIGHTS); kept for existing imports */
export const HIGH_EXPOSURE = 0.5;

/**
 * Weight of each category in hours freed and pay at stake: AI does it → the full time, AI speeds it up → half.
 * payAtStake = annual × (percent.ai_does × 1 + percent.ai_speeds × 0.5) / 100, so it always agrees with the
 * categories on screen.
 */
export const AT_STAKE_WEIGHTS = { ai_does: 1, ai_speeds: 0.5, human_edge: 0, no_data: 0 } as const;
/** The same weights for UI code: hoursFreed and payAtStake count ai_does × 1 and ai_speeds × 0.5. */
export const PAY_WEIGHTS = { ai_does: AT_STAKE_WEIGHTS.ai_does, ai_speeds: AT_STAKE_WEIGHTS.ai_speeds } as const;

/**
 * Typical week (defaultShares): weight = importance × relevance/100 × sqrt(occurrences per year), where the O*NET
 * frequency category mean (1..7) maps to occurrences per year by linear interpolation of these anchors.
 */
export const FREQ_PER_YEAR: Record<number, number> = { 1: 1, 2: 3, 3: 20, 4: 80, 5: 250, 6: 750, 7: 2000 };
/** Frequency category used when a rated task has no frequency (O*NET "more than weekly"). */
export const FREQ_DEFAULT_CATEGORY = 4;
export const DEFAULT_SHARE_MIN = 3;
export const DEFAULT_SHARE_MAX = 25;

export const WEEK_HOURS = 40;

/** Score: score = base + (100 − base) × PRACTICE_GAIN × F, F = (1 − e^(−n / PRACTICE_SCALE)) × avgScore. */
export const PRACTICE_GAIN = 0.45;
export const PRACTICE_SCALE = 20;

/** defaultShares keeps the top N tasks; normalizeShares keeps at most MAX_WEEK_TASKS. */
export const DEFAULT_WEEK_TASKS = 10;
export const MAX_WEEK_TASKS = 14;

/**
 * Neighbours (01.1.4, reworked after the stage-01 review). Rank = (similarity + bonuses) × (1 + tie-break),
 * where similarity is the cosine of centred skill+knowledge importance, bonuses prefer O*NET Related Occupations
 * and the same SOC major group, and the human-share gain is a filter (> 0) plus a tie-breaker of at most 10%.
 */
export const RELATED = {
  minSimilarity: 0.86, // calibrated on the build: below it pairs stop looking like the same kind of work
  minSimilarityRelated: 0.7, // O*NET Related Occupations (any tier) may be a bit further
  minSimilarityOtherGroup: 0.92, // another SOC major group and not O*NET-related: only near-identical skill profiles
  maxEducationStep: 2, // O*NET Required Level of Education categories above the source
  bonusPrimaryShort: 0.15,
  bonusPrimaryLong: 0.1,
  bonusSameMajor: 0.02,
  bonusSupplemental: 0.05,
  payBonus: 0.05, // up to +0.05 for a target paying 30% or more above the source
  maxPayDrop: 0.05, // a target paying more than 5% less is used only when fewer than minNeighbours others exist
  missingSkillMinImportance: 3.5, // listed only when the target rates it between important (3) and very important (4) or more
  gainTieBreak: 0.1, // at most +10% for a gain of 0.5 or more
  minNeighbours: 3, // when fewer have a positive gain, neighbours about as safe fill up to this number
  equalGainTolerance: 0.05, // 'about as safe': typical human share at most 5 points lower
  jobZoneSpan: 1,
  keep: 8,
  missingSkillGap: 0.75,
  missingSkillsMax: 5,
} as const;

/** AEI releases since August 2025 used for everObserved and history (Claude.ai periods). */
export const HISTORY_MIN_PERIODS = 3;
