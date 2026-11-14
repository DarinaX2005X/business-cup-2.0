/*
 * Prop types for the craft kit. Domain shapes come from src/domain/types.ts (PLAN «Контракты»);
 * the kit adds only view models of its own below.
 */

import type { Category, EvidenceLevel } from '@/domain/types';

export type { Category, Locale, EvidenceLevel, TaskEvidence, OccTask, OccupationBundle, WeekShare, SlipError } from '@/domain/types';
export type SlipErrorType = import('@/domain/types').SlipError['type'];

/* ---------- kit-level view models ---------- */

/** One segment of the Week Bar: a task with its share of the 40-hour week. */
export interface WeekTask {
  id: string;
  /** Short label (2–4 words) shown under the tile; from `/api/occupations/:code/texts` `short`. */
  label: string;
  /** Full O*NET task text, used in the accessible name and tooltip. */
  text: string;
  /** 0..100, all tasks sum to 100 */
  share: number;
  category: Category;
  evidenceLevel?: EvidenceLevel;
}

/** A character range in the source text of a Rep document, end exclusive. */
export type CharRange = [number, number];

export type ReviewMarkKind = 'found' | 'missed' | 'false' | 'first_false';

/** An editor's mark on a reviewed Rep card; drawn on the text and as a note on the margin. */
export interface ReviewMark {
  id: string;
  kind: ReviewMarkKind;
  start: number;
  end: number;
  /** Number in the margin circle for found and missed errors. */
  n?: number;
  title: string;
  body?: string;
}

export type Surface = 'paper' | 'violet';
