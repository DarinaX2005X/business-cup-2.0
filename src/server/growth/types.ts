import type { Category, ProfileSkill, RepType, SkillKind } from '@/domain/types';

/*
 * Contracts of the growth core (round 3): skills from the résumé, gaps, and the 90-day plan.
 * The client imports these types; nothing here runs.
 */

// ---------------------------------------------------------------------------------------------
// Skills

/** One thing the person's job, or a job next to it, relies on. */
export interface SkillNeed {
  /** O*NET element id, or `tech:<name>` for a technology. */
  id: string;
  kind: SkillKind;
  /** O*NET name (the client shows the plain label from `skills.onet.<key>` when there is one). */
  name: string;
  /** i18n key part for O*NET elements (`2_B_1_e`), null for technologies. */
  key: string | null;
}

export interface SkillGap extends SkillNeed {
  /**
   * own_job: rated important for their job and not shown in the résumé;
   * next_job: jobs next to theirs need it more than theirs does;
   * in_demand: a technology often named in job posts for their job.
   */
  reason: 'own_job' | 'next_job' | 'in_demand';
  /** Jobs it opens (next_job), best match first. */
  leadsTo: { code: string; slug: string; title: string }[];
  /** O*NET importance for their own job (1..5) when rated. */
  importance: number | null;
}

export interface SkillView extends ProfileSkill {
  /** A technology O*NET says employers often ask for (for this job or overall). */
  hot: boolean;
  /** Plain label key of the O*NET element it counts toward. */
  onetKey: string | null;
  onetName: string | null;
}

export interface SkillsResponse {
  /** Free: the list and gaps are part of Pro; `count` and `needs` still come. */
  locked: boolean;
  occupation: { code: string; title: string; jobTitle: string };
  xrayId: string;
  /** empty: nothing read or added yet. */
  status: 'ready' | 'empty';
  skills: SkillView[];
  /** How many skills the profile holds (shown to Free as a teaser). */
  count: number;
  /** What their job relies on most, with whether the résumé shows it (Free sees names only). */
  needs: (SkillNeed & { importance: number; shown: boolean | null })[];
  gaps: SkillGap[];
  seniorityYears: number | null;
  /** The read was made against another occupation: what it checked may not cover this job. */
  otherOccupation: boolean;
  extractedAt: string | null;
}

export type SkillsPatch =
  | { op: 'confirm'; id: string }
  | { op: 'confirm_all' }
  | { op: 'remove'; id: string }
  | { op: 'restore'; id: string }
  | { op: 'add'; name: string; kind?: SkillKind };

// ---------------------------------------------------------------------------------------------
// Plan

export type PlanItemKind = 'rep' | 'skill' | 'work' | 'review';
export type PlanMonth = 1 | 2 | 3;

export interface PlanItem {
  /** `<planId>-<week>-<n>`: stable for the life of the plan. */
  id: string;
  kind: PlanItemKind;
  /** The action in plain words, task and skill names already filled in. */
  text: string;
  /** The same sentence with `{task}` / `{skill}` where the names go (the screen sets them on plates). */
  template: string;
  /** A task of the person's week (rep, work and some skill items). */
  taskId: string | null;
  taskLabel: string | null;
  category: Category | null;
  repType: RepType | null;
  /** A gap or a skill of the person (skill items). */
  skillId: string | null;
  skillName: string | null;
}

export interface PlanWeek {
  n: number;
  month: PlanMonth;
  focus: string;
  /** The task the focus names, if any. */
  focusTaskId: string | null;
  items: PlanItem[];
}

/** Stored as `plan:<xrayId>`: the person's current plan for that map. */
export interface GrowthPlan {
  id: string;
  xrayId: string;
  profileId: string;
  occupationCode: string;
  jobTitle: string;
  /** Hash of the map and skills it was written from: when it differs from now the plan is stale. */
  inputsKey: string;
  weeks: PlanWeek[];
  createdAt: string;
  /** Set when the plan was rewritten from a week on, keeping the weeks before it. */
  refreshedFromWeek?: number;
}

export interface PlanResponse {
  status: 'ready';
  locked: boolean;
  xrayId: string;
  planId: string;
  jobTitle: string;
  /** 1..12: the week the calendar is in (week 1 starts the day the plan was first made). */
  currentWeek: number;
  startDay: string;
  /** Free: week 1 only; the other weeks come as `{ n, month, focus: '', items: [] }` with locked: true. */
  weeks: (PlanWeek & { locked?: boolean })[];
  done: string[];
  /** The map or the skills changed after the plan was written. */
  stale: boolean;
  createdAt: string;
}

export interface PlanPending {
  status: 'generating';
  xrayId: string;
}

export interface PlanSummary {
  status: 'ready' | 'none';
  xrayId: string | null;
  currentWeek: number;
  weekDone: number;
  weekTotal: number;
  totalDone: number;
  total: number;
  /** The first unchecked item of the current week. */
  next: { id: string; text: string } | null;
  locked: boolean;
}

export interface PlanCheckResponse {
  itemId: string;
  done: boolean;
  doneIds: string[];
  pointsAwarded: import('@/domain/types').PointsAward[];
}
