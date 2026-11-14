import type { Category } from '@/domain/types';
import type { CoachTier } from './access';

/**
 * Shapes of the coach API. Type-only module: client components import it with `import type`.
 */

export type { CoachTier };

export interface CoachMessage {
  /** Client-made id for the person's messages (dedupes a resend), server-made for the coach's. */
  id: string;
  role: 'user' | 'coach';
  text: string;
  at: string;
  /** The person spoke this message; the audio itself is never stored. */
  via?: 'voice';
  /** Length of the voice message in seconds. */
  seconds?: number;
  /** The person stopped the answer before it was complete. */
  stopped?: boolean;
}

/** A question the coach suggests, with the line of the person's own data it comes from. */
export interface CoachStarter {
  q: string;
  basis: string | null;
  /** Category of the task the question is about, for the small tile beside it. */
  cat?: Category;
}

/** «What your coach sees»: the person's own numbers, drawn beside the conversation. */
export interface CoachSnapshot {
  jobTitle: string;
  xrayId: string;
  score: number;
  payAtStake: number | null;
  salarySource: 'bls_median' | 'user' | 'none';
  hours: Record<Category, number>;
  /** Busiest tasks of the week, largest first. */
  tasks: { id: string; label: string; hours: number; category: Category }[];
  streak: number;
  reps: number;
  proof: number;
  points: number;
  /** Checked / total items of the 90-day plan, when the plan exists. */
  plan: { done: number; total: number } | null;
  /** Confirmed skills, when the person has them. */
  skills: number | null;
  nextJob: { title: string; slug: string } | null;
}

export interface CoachState {
  access: 'coach' | 'locked';
  tier: CoachTier;
  hasMap: boolean;
  me: CoachSnapshot | null;
  starters: CoachStarter[];
  /** Saved conversation (coach access only), oldest first, at most HISTORY_MAX. */
  messages: CoachMessage[];
  /** Messages left today under the daily cap. */
  left: number;
  cap: number;
}

export interface CoachPreview {
  question: string;
  answer: string;
  basis: string | null;
}

/** One line of the POST /api/coach/messages stream (NDJSON). */
export type CoachEvent =
  | { t: 'accepted'; id: string }
  | { t: 'transcript'; id: string; text: string; seconds: number }
  | { t: 'delta'; text: string }
  | { t: 'done'; message: CoachMessage; left: number }
  | { t: 'error'; code: CoachStreamError; transcript?: string };

export type CoachStreamError = 'coach_failed' | 'no_speech' | 'transcribe_failed' | 'budget' | 'rate_limited';
