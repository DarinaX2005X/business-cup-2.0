import type { RepType } from '@/domain/types';

/**
 * Shapes of the progress API (05.1). Type-only module: the client imports these with `import type`.
 * Every text is a dictionary key plus params, so the screen words it in the visitor's language.
 */

export interface Phrase {
  key: string;
  params: Record<string, string | number>;
}

/** One point on the score line: the week map, a completed rep or the latest change of the week. */
export interface ScorePoint {
  id: string;
  kind: 'map' | 'rep' | 'edit';
  at: string;
  /** Local day YYYY-MM-DD (the profile's time zone). */
  day: string;
  score: number;
  /** One decimal, so a small step still shows on the line. */
  exact: number;
  /** Score just before this point (rep points), for «71 → 72». */
  before?: number;
  type?: RepType;
  taskId?: string;
  taskShort?: string;
  /** Why the score moved: `progress.reason.*`. */
  reason: Phrase;
}

export interface CalendarDay {
  day: string;
  /** Completed reps that day. */
  reps: number;
  /** After today. */
  future: boolean;
  /** Before the profile existed. */
  before: boolean;
}

export interface ProofView {
  id: string;
  repId: string;
  type: RepType;
  taskId: string;
  taskShort: string;
  occupationCode: string;
  /** 0..100 */
  score: number;
  summary: Phrase;
  at: string;
  day: string;
  public: boolean;
  /** Minutes the person logged using this task at work («I used this at work»). */
  workMinutes: number;
}

export interface ProgressResponse {
  hasMap: boolean;
  xrayId: string | null;
  occupationTitle: string | null;
  /** Current score of the latest week map, null without one. */
  score: number | null;
  /** Score when the week was first mapped. */
  startScore: number | null;
  history: ScorePoint[];
  streak: { current: number; best: number; today: string; calendar: CalendarDay[] };
  counts: { reps: number; caught: number; hoursPractised: number };
  proof: ProofView[];
  publicSlug: string | null;
  publicCount: number;
  isPro: boolean;
}

export interface PlanWeek {
  /** 1..12 */
  n: number;
  focus: Phrase;
  taskIds: string[];
  repType: RepType | null;
  start: string;
  end: string;
  done: { repId: string; type: RepType; taskId: string; taskShort: string; score: number; day: string; onFocus: boolean }[];
}

export interface PlanMonth {
  key: 'handoff' | 'supervise' | 'edge';
  weeks: PlanWeek[];
}

export interface PlanResponse {
  xrayId: string;
  start: string;
  /** Index of the current week, 0..11; 12 once the plan is over. */
  current: number;
  months: PlanMonth[];
  tasks: Record<string, string>;
}

export interface ReviewKitSection {
  key: 'changed' | 'judgment' | 'next' | 'evidence';
  title: string;
  items: string[];
}

export interface ReviewKitResponse {
  title: string;
  subtitle: string;
  sections: ReviewKitSection[];
  markdown: string;
  generatedAt: string;
  /** Items the number check removed (for the developer log; never shown). */
  dropped: number;
  pointsAwarded: import('@/domain/types').PointsAward[];
}

export interface PublicPortfolio {
  slug: string;
  occupationTitle: string;
  score: number | null;
  reps: number;
  byType: Record<RepType, number>;
  since: string;
  entries: Omit<ProofView, 'public' | 'workMinutes' | 'repId' | 'occupationCode'>[];
}
