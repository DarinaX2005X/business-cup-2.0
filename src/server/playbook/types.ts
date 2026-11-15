import type { Category, Profile } from '@/domain/types';
import type { SlipErrorType } from '@/domain/reps';

/*
 * Contracts of Playbook and Second look (05.3). The client imports these types; nothing here runs.
 * `PlaybookProfileFields` is stored on the profile next to the core fields (the same way the reps
 * engine keeps `workLog`); REQUESTS.md «05.3» asks MAIN to fold it into src/domain/types.ts.
 */

/** A person's own version of a playbook instruction (the «Edit» action). */
export interface PlaybookEdit {
  text: string;
  at: string;
}

export interface PlaybookProfileFields {
  playbook?: {
    /** taskId → the person's edited instruction. */
    edits?: Record<string, PlaybookEdit>;
    /** Second look keeps only how many times it ran, never the text. */
    secondLook?: { used: number; lastAt: string | null };
  };
}

export type PlaybookProfile = Profile & PlaybookProfileFields;

/** Where the instruction on a card comes from, in order of precedence. */
export type InstructionSource = 'edited' | 'practice' | 'starter';

/** The person's best scored Delegate instruction for a task. */
export interface PracticeInstruction {
  text: string;
  /** 0..1, the Delegate grade. */
  score: number;
  repId: string;
  day: string;
}

export type CheckOrigin =
  /** written for this occupation and task by `playbook.starter` */
  | 'starter'
  /** a Delegate trap the person did not catch (or only the AI's result caught) */
  | 'trap'
  /** a Spot the slip mistake the person did not find on this task */
  | 'slip';

export interface CheckItem {
  id: string;
  text: string;
  origin: CheckOrigin;
  /** slip: the mistake type, for the label. */
  slipType?: SlipErrorType;
  /** Day of the rep the personal item comes from. */
  day?: string;
}

export interface PlaybookCard {
  taskId: string;
  short: string;
  text: string;
  category: Category;
  /** Hours of the 40-hour week (from the map). */
  hours: number;
  /** Free: every card after the first is locked; a locked card carries no instruction or checks. */
  locked: boolean;
  /** What the card shows now; null while the starter is being written and nothing personal exists. */
  instruction: { text: string; source: InstructionSource } | null;
  /** Best practice instruction, also when it is below the bar or an edit sits on top of it. */
  practice: PracticeInstruction | null;
  /** The starter text, so «Use the starter again» can show it without a reload. */
  starter: string | null;
  checks: CheckItem[];
  /** «Copy instruction» already counted today (points once a day per task). */
  copiedToday: boolean;
}

export type StarterState = 'ready' | 'pending' | 'unavailable';

export interface PlaybookView {
  jobTitle: string;
  occupationCode: string;
  /** The whole playbook is open (Max). */
  pro: boolean;
  /** «Practise this» starts a rep (Pro or Max); otherwise it leads to Today. */
  practise: boolean;
  starter: StarterState;
  /** At least one finished Delegate rep on a card's task. */
  practised: boolean;
  /** Score a practice instruction needs to take the starter's place (0..1). */
  practiceBar: number;
  cards: PlaybookCard[];
}

// ---------------------------------------------------------------------------------------------
// Second look

export interface SecondLookMark {
  id: string;
  /** Character range in `document`, end exclusive. */
  start: number;
  end: number;
  type: SlipErrorType;
  why: string;
  check: string;
}

export interface SecondLookTask {
  taskId: string;
  short: string;
  hours: number;
}

export interface SecondLookState {
  pro: boolean;
  /** Free runs left (Max: null, no limit shown). */
  freeLeft: number | null;
  jobTitle: string | null;
  tasks: SecondLookTask[];
}

export interface SecondLookResult {
  /** The pasted text as it was checked (light markup, normalised spaces); marks point into it. */
  document: string;
  marks: SecondLookMark[];
  freeLeft: number | null;
}
