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

/** Category thresholds (PLAN «Категория задачи»). */
export const CATEGORY_THRESHOLDS = {
  aiDoesExposure: 0.75,
  aiDoesAutomation: 0.5,
  aiSpeedsExposure: 0.25,
} as const;

/** Tasks with exposure >= this count toward pay at stake. */
export const HIGH_EXPOSURE = 0.5;

export const WEEK_HOURS = 40;

/** Score: score = base + (100 − base) × PRACTICE_GAIN × F, F = (1 − e^(−n / PRACTICE_SCALE)) × avgScore. */
export const PRACTICE_GAIN = 0.45;
export const PRACTICE_SCALE = 20;

/** defaultShares keeps the top N tasks; normalizeShares keeps at most MAX_WEEK_TASKS. */
export const DEFAULT_WEEK_TASKS = 12;
export const MAX_WEEK_TASKS = 14;

/** Neighbours (01.1.4). */
export const RELATED = {
  candidates: 30,
  relatedBoost: 0.1,
  jobZoneSpan: 1,
  keep: 8,
  missingSkillGap: 0.75,
  missingSkillsMax: 5,
} as const;

/** AEI releases since August 2025 used for everObserved and history (Claude.ai periods). */
export const HISTORY_MIN_PERIODS = 3;
