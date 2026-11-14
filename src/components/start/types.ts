import type { OccupationBundle, ResumeFacts, WeekShare, XrayResult } from '@/domain/types';

/** The four screens of /start, in order. `scan` is step 4: the scan plays where the week was edited. */
export type Step = 'who' | 'occupation' | 'week' | 'scan';
export const STEPS: Step[] = ['who', 'occupation', 'week', 'scan'];

export type InputSource = XrayResult['inputSource'];
export type SampleName = 'nurse' | 'electrician';

/* ---------- API shapes (02.1, see src/server/xray/*) ---------- */

export interface SearchItem {
  code: string;
  title: string;
  matched: string;
  kind: 'primary' | 'alt' | 'reported' | 'alias';
  localTitle: string | null;
}

export interface SearchResponse {
  results: SearchItem[];
  suggestions: { code: string; title: string; localTitle: string | null }[];
  translated: string | null;
  hint: 'try_english' | null;
  /** Cyrillic title with no confident local match, asked without translation: translate=1 may find it. */
  translatable?: boolean;
}

export interface RankedOccupation {
  code: string;
  title: string;
  localTitle: string | null;
  reason: string;
}

export interface ResumeAnalysis {
  facts: ResumeFacts;
  ranked: RankedOccupation[];
  confidence: number;
  truncated: boolean;
}

export interface WeekProposal {
  shares: WeekShare[];
  matches: Record<string, string[]>;
  unmappedDuties: string[];
  source: 'resume' | 'onet';
}

export interface TaskTexts {
  tasks: Record<string, { text: string; short: string }>;
  ready: boolean;
}

/* ---------- flow state ---------- */

/** Where the text the person gave us came from, so later screens can say it back to them. */
export interface TextOrigin {
  mode: 'resume' | 'description';
  sample: SampleName | null;
  fileName: string | null;
}

export interface Analysis extends ResumeAnalysis {
  origin: TextOrigin;
}

/** The occupation the week is built on, with the words the person used for their job. */
export interface Chosen {
  code: string;
  title: string;
  jobTitle: string;
  inputSource: InputSource;
}

/** A map opened from /x/[id] through «Change» or «Add tasks». */
export interface FromMap {
  id: string;
  version: number;
  isOwner: boolean;
  occupationCode: string;
  jobTitle: string;
  shares: WeekShare[];
  inputSource: InputSource;
}

export interface Draft {
  step: Step;
  query: string;
  analysis: Analysis | null;
  selected: string | null;
  chosen: Chosen | null;
  week: WeekProposal | null;
  from: FromMap | null;
  /** Text being read right now; kept so a reload during the read starts it again (this tab only). */
  pending?: { text: string; origin: TextOrigin } | null;
}

export type Bundle = OccupationBundle;

/** What made step 1 show a message after a failed résumé or description read. */
export type WhoProblem =
  | { kind: 'not_resume'; signals: { dates: boolean; titles: boolean; verbs: boolean } | null }
  | { kind: 'not_work' }
  | { kind: 'too_short' }
  | { kind: 'unclear' }
  | { kind: 'no_match' }
  | { kind: 'ai_down' }
  | { kind: 'rate_limited' }
  | { kind: 'network' };
