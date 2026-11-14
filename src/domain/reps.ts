// Pure logic of the daily reps (stage 03.1): document normalisation, quote validation, grading,
// streaks, local days, seeded task choice and the AI-or-me round. No I/O here.
//
// The base contracts (Rep, RepPublic, RepResult, RepReveal, AiOrMeRound, ProofEntry, Profile) live in
// ./types. The types below extend them with what the engine stores and the Today screen needs; they are
// listed in REQUESTS.md (03.1) so MAIN can fold them into ./types.

import type {
  AiOrMeRound,
  Category,
  Locale,
  OccTask,
  OccupationBundle,
  Profile,
  Rep,
  RepPublic,
  RepResult,
  RepReveal,
  RepType,
  SlipError,
  Trap,
  WeekShare,
} from './types';

// ---------------------------------------------------------------------------------------------
// Extended contracts

export type SlipErrorType = SlipError['type'];
export const SLIP_ERROR_TYPES: readonly SlipErrorType[] = ['fact', 'logic', 'compliance', 'omission', 'tone', 'calculation'];

/** Why a rep differs from what was asked for; the screen shows a caption, never an error. */
export type RepNote =
  | 'type_swapped' // "Today's rep is a Spot the slip: our writing service is busy"
  | 'english_only' // "Available in English today"
  | 'related_job'; // "From a related job"

export type RepFlag = 'over_selected' | 'too_broad' | 'ended_early' | 'keyword_grade' | 'harm';

export type CriterionStatus = 'met' | 'partly' | 'missed';

/** A rubric line with hidden keywords (used only when the model cannot grade). */
export interface RubricItem {
  id: string;
  text: string;
  keywords: string[];
}

export interface CriterionGrade {
  id: string;
  status: CriterionStatus;
  quote?: string;
  /** One sentence in the rep's language: what worked or which line was missing. */
  note?: string;
}

/**
 * Map score before and after this rep. `before`/`after` (= `from`/`to`) are the rounded scores the map
 * shows; `fromExact`/`toExact` carry one decimal, so a small step reads "79.0 → 79.6" honestly.
 */
export interface ScoreChange {
  before: number;
  after: number;
  from: number;
  to: number;
  fromExact: number;
  toExact: number;
}

export interface RepResultFull extends Omit<RepResult, 'flags' | 'criteria' | 'scoreChange'> {
  flags?: RepFlag[];
  criteria?: CriterionGrade[];
  scoreChange: ScoreChange;
  /** slip: merged user ranges that were graded. */
  ranges?: [number, number][];
  /** slip: found or not, aligned with reveal.errors. */
  errorsFound?: boolean[];
  /** slip: highlights that hit no mistake; the first is free ("Not on our list"). */
  falseRanges?: [number, number][];
  /** slip: highlights that covered a mistake but were too long to count ("Narrow it down to the wrong part"). */
  tooBroad?: [number, number][];
  /** slip: every graded highlight with its status (hit, near, too_broad, false) and the errors it found. */
  marks?: RangeMark[];
  /** delegate: traps the person missed but the AI's result pointed out by itself. */
  trapsCaughtByAi?: string[];
  /** edge: the harmful move found in the person's replies (quote checked in their text); the score is capped at 0.4. */
  harm?: { quote: string; why: string };
  /** delegate: the one instruction line that would have helped most; edge: one-sentence feedback. */
  summary?: string;
  /** delegate: feedback on the user's "what would you fix" sentence. */
  fixFeedback?: string;
}

export interface TrapSpot {
  trapId: string;
  where: 'inputs' | 'run';
  start: number;
  end: number;
}

/** A Delegate trap grounded in the material: two verbatim quotes of the inputs that contradict each other. */
export type TrapFull = Trap & { evidence?: string[] };

export interface RepRevealFull extends Omit<RepReveal, 'errors' | 'traps'> {
  /** slip: the planted mistakes, each with `focusStart`/`focusEnd`: the exact wrong part. */
  errors?: (SlipError & { focusStart?: number; focusEnd?: number })[];
  traps?: TrapFull[];
  /** delegate: where each trap sits in the inputs (its evidence and keywords) and in the AI's result. */
  trapSpots?: TrapSpot[];
  /** delegate: one strong instruction for this scenario, shown after grading. */
  exemplar?: string;
}

/** What the engine stores under `rep:<id>`. */
export interface RepRecord extends Omit<Rep, 'result' | 'delegate' | 'edge'> {
  docType?: string;
  notes?: RepNote[];
  delegate?: Omit<NonNullable<Rep['delegate']>, 'criteria' | 'traps'> & { criteria: RubricItem[]; traps: TrapFull[]; exemplar?: string };
  edge?: Omit<NonNullable<Rep['edge']>, 'criteria'> & { criteria: RubricItem[] };
  result?: RepResultFull;
  reveal?: RepRevealFull;
}

/** What the client receives: RepPublic plus labels and captions. */
export interface RepView extends Omit<RepPublic, 'result' | 'reveal' | 'delegate'> {
  taskShort: string;
  occupationCode: string;
  docType?: string;
  notes: RepNote[];
  difficulty: 1 | 2 | 3;
  day: string;
  /** delegate: `review` is the person's highlights in `run` and their fix sentence, once submitted. */
  delegate?: NonNullable<RepPublic['delegate']> & { review?: { ranges: [number, number][]; fix: string } };
  result?: RepResultFull;
  reveal?: RepRevealFull;
}

export interface AiOrMeCard {
  taskId: string;
  text: string;
  answer: 'ai' | 'human';
  fact: { key: string; params: Record<string, number | string> };
  /** false for no_data fillers: shown, but not scored. */
  counted: boolean;
}

export interface AiOrMeRoundFull extends Omit<AiOrMeRound, 'cards' | 'completed'> {
  day: string;
  cards: AiOrMeCard[];
  completed?: { correct: boolean[]; right: number; total: number };
}

export interface WorkLogEntry {
  id: string;
  taskId: string;
  minutes: number;
  day: string;
  at: string;
}

export interface AiOrMeLogEntry {
  day: string;
  roundId: string;
  correct: boolean[];
  right: number;
  total: number;
}

/** Optional profile fields owned by the reps engine (REQUESTS.md 03.1). */
export interface RepsProfileFields {
  workLog?: WorkLogEntry[];
  aiOrMe?: AiOrMeLogEntry[];
}

export type RepsProfile = Profile & RepsProfileFields;

// ---------------------------------------------------------------------------------------------
// Text normalisation

const MARKUP_RE = /[|#*_`<>[\]]/;

/**
 * The stored form of a document: LF line ends, no tabs or exotic spaces, single spaces inside lines,
 * no trailing spaces, at most one blank line in a row, straight quotes. Quotes are matched against this.
 */
export function normalizeDocument(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[   \t - ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .split('\n')
    .map((line) => {
      const lead = /^ */.exec(line)![0].length;
      const body = line.slice(lead).replace(/ {2,}/g, ' ').trimEnd();
      // keep list indentation (up to 2 spaces), drop the rest
      return body ? ' '.repeat(Math.min(lead, 2)) + body : '';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Keeps only the light markup documents use ("# ", "## ", "- ", "|" tables): deeper headings become
 * "## ", bold/italic/code markers, links, block quotes, HTML tags and rules are removed, "* " and "+ "
 * bullets become "- ". For model output that slipped into full Markdown.
 */
export function toLightMarkup(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      let l = line;
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) return '';
      l = l.replace(/^(\s*)#{3,6}\s+/, '$1## ');
      l = l.replace(/^(\s*)>\s?/, '$1');
      l = l.replace(/^(\s*)[*+]\s+/, '$1- ');
      l = l.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
      l = l.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1$2');
      l = l.replace(/`([^`]*)`/g, '$1');
      l = l.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
      l = l.replace(/<\/?[a-zA-Z][^>]*>/g, '');
      return l;
    })
    .join('\n');
}

/** A quote as the model wrote it → the form searched in the document. */
export function normalizeQuote(quote: string): string {
  return normalizeDocument(quote)
    .replace(/\s+/g, ' ')
    .replace(/^["'«]+|["'»]+$/g, '')
    .trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** All start positions of `needle` in `hay`, overlapping occurrences included. */
export function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Slip validation

export interface SlipDraftError {
  quote: string;
  type: string;
  explanation: string;
  fix: string;
  /** The exact wrong part inside the quote, as the generator sees it (optional; checked). */
  focus?: string | null;
}

/** A stored slip error with its focus: the exact wrong part, in document offsets. */
export type SlipErrorFull = SlipError & { focusStart: number; focusEnd: number };

export interface SlipDraft {
  title: string;
  brief: string;
  docType?: string | null;
  document: string;
  errors: SlipDraftError[];
}

export interface SlipContent {
  title: string;
  brief: string;
  docType: string;
  slip: { document: string; errors: SlipErrorFull[] };
}

export interface SlipRules {
  /** Exact number of planted mistakes. */
  n: number;
  /** Allowed mistake types. */
  types: readonly SlipErrorType[];
  minWords?: number;
  maxWords?: number;
}

export const SLIP_WORDS = { min: 150, max: 420 } as const; // prompt asks for 180–350; a little slack
export const QUOTE_WORDS = { min: 4, max: 30 } as const;

export type SlipValidation = { ok: true; content: SlipContent; repairs: string[] } | { ok: false; problems: string[] };

/**
 * Checks a generated slip and turns quotes into ranges. The document is normalised first and kept in
 * that form. A quote must sit inside one line, have 4–30 words, contain no markup characters, occur
 * exactly once and not overlap another quote. Small, verifiable repairs are allowed (case or trailing
 * punctuation differing from the document); everything else is reported as a problem for the retry.
 */
export function validateSlip(draft: SlipDraft, rules: SlipRules): SlipValidation {
  const problems: string[] = [];
  const repairs: string[] = [];
  const document = normalizeDocument(toLightMarkup(draft.document ?? ''));
  const words = wordCount(document);
  const minWords = rules.minWords ?? SLIP_WORDS.min;
  const maxWords = rules.maxWords ?? SLIP_WORDS.max;
  if (words < minWords || words > maxWords) problems.push(`The document has ${words} words; it must have 180–350.`);
  if (/\[[^\]]{1,40}\]|\{\{|\bTODO\b|\bXXX\b|lorem ipsum/i.test(document)) problems.push('The document contains placeholders such as [Name]; fill in invented details.');
  if (!draft.title?.trim()) problems.push('title is empty.');
  if ((draft.errors ?? []).length !== rules.n) problems.push(`There must be exactly ${rules.n} mistakes; you listed ${(draft.errors ?? []).length}.`);

  const errors: SlipErrorFull[] = [];
  (draft.errors ?? []).forEach((e, i) => {
    const label = `Mistake ${i + 1}`;
    const type = String(e.type ?? '').trim().toLowerCase() as SlipErrorType;
    if (!rules.types.includes(type)) problems.push(`${label}: type "${e.type}" is not one of ${rules.types.join(', ')}.`);
    if (!e.explanation?.trim()) problems.push(`${label}: explanation is empty.`);
    if (!e.fix?.trim()) problems.push(`${label}: fix is empty.`);
    if (/\n/.test((e.quote ?? '').trim())) {
      problems.push(`${label}: the quote spans several lines; quote a phrase inside one line.`);
      return;
    }
    let quote = normalizeQuote(e.quote ?? '');
    if (!quote) {
      problems.push(`${label}: quote is empty.`);
      return;
    }
    if (MARKUP_RE.test(quote) || /^- /.test(quote)) {
      problems.push(`${label}: the quote "${quote}" contains markup characters (| # * _ \` [ ] < > or a leading "- "); quote plain words only.`);
      return;
    }
    let found = occurrences(document, quote);
    if (found.length === 0) {
      // verifiable repairs: trailing punctuation, letter case
      const trimmed = quote.replace(/[.,;:!?]+$/, '');
      if (trimmed !== quote && occurrences(document.toLowerCase(), trimmed.toLowerCase()).length > 0) {
        quote = trimmed;
        found = occurrences(document, quote);
        repairs.push(`${label}: dropped trailing punctuation`);
      }
      if (found.length === 0) {
        const lower = occurrences(document.toLowerCase(), quote.toLowerCase());
        if (lower.length === 1) {
          quote = document.slice(lower[0], lower[0] + quote.length);
          found = lower;
          repairs.push(`${label}: case taken from the document`);
        }
      }
    }
    if (found.length === 0) {
      problems.push(`${label}: the quote "${quote}" does not appear in the document word for word. Copy it exactly from the document.`);
      return;
    }
    if (found.length > 1) {
      problems.push(`${label}: the quote "${quote}" appears ${found.length} times; quote a longer phrase that appears once.`);
      return;
    }
    const qWords = wordCount(quote);
    if (qWords < QUOTE_WORDS.min || qWords > QUOTE_WORDS.max) {
      problems.push(`${label}: the quote has ${qWords} words; it must have 4–30 (ideally 5–12).`);
      return;
    }
    const start = found[0];
    const fix = e.fix.trim();
    // focus: the generator's own pick when it sits inside the quote, else the word diff quote → fix
    let [fa, fb] = type === 'omission' ? [0, quote.length] : focusInQuote(quote, fix);
    const given = normalizeQuote(e.focus ?? '');
    if (type !== 'omission' && given && given.length >= 2 && given.length < quote.length) {
      const at = quote.toLowerCase().indexOf(given.toLowerCase());
      if (at >= 0) [fa, fb] = [at, at + given.length];
    }
    errors.push({
      quote,
      start,
      end: start + quote.length,
      focusStart: start + fa,
      focusEnd: start + fb,
      type,
      explanation: e.explanation.trim(),
      fix,
    });
  });

  const sorted = [...errors].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      problems.push(`The quotes "${sorted[i - 1].quote}" and "${sorted[i].quote}" overlap; each mistake needs its own place in the document.`);
    }
  }
  for (const e of errors) {
    if (normalizeQuote(e.fix) === e.quote) problems.push(`The fix for "${e.quote}" repeats the quote; give the corrected wording.`);
  }

  if (problems.length) return { ok: false, problems };
  const docType = (draft.docType ?? '').replace(/\s+/g, ' ').trim() || draft.title.trim();
  return {
    ok: true,
    repairs,
    content: { title: draft.title.trim(), brief: (draft.brief ?? '').trim(), docType, slip: { document, errors: sorted } },
  };
}

/** Re-checks stored ranges (bank files, old records): every error's range must hold its quote. */
export function slipRangesValid(slip: { document: string; errors: SlipError[] }): boolean {
  if (!slip.document || !slip.errors.length) return false;
  let prevEnd = -1;
  for (const e of [...slip.errors].sort((a, b) => a.start - b.start)) {
    if (e.start < 0 || e.end > slip.document.length || e.start >= e.end) return false;
    if (slip.document.slice(e.start, e.end) !== e.quote) return false;
    if (e.start < prevEnd) return false;
    const f = e as Partial<SlipErrorFull>;
    if (f.focusStart !== undefined && (f.focusStart < e.start || (f.focusEnd ?? 0) > e.end || (f.focusEnd ?? 0) <= f.focusStart)) return false;
    prevEnd = e.end;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Ranges and grading

export type Range = [number, number];

export const MAX_RANGES = 12;
export const FALSE_PENALTY = 0.15;
/** Selecting more than this share of the document scores 0. */
export const OVER_SELECTED = 0.35;
/** A highlight longer than max(BROAD_FACTOR × focus, quote + BROAD_SLACK) characters is too broad to count. */
export const BROAD_FACTOR = 3;
export const BROAD_SLACK = 40;

/** Clamps to the document, drops empty ranges, merges overlapping or touching ones and keeps at most 12. */
export function mergeRanges(ranges: readonly Range[], docLength: number, max = MAX_RANGES): Range[] {
  const clean = ranges
    .map(([a, b]): Range => [Math.max(0, Math.min(a, b, docLength)), Math.min(docLength, Math.max(a, b, 0))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out.slice(0, max);
}

function overlap(a: Range, b: Range): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

interface Tok {
  key: string;
  start: number;
  end: number;
}

/** Whitespace tokens compared without case and without punctuation at their edges ("daily." = "daily"). */
function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out.push({ key: m[0].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const EDGE_PUNCT_START = /^[("'«“]+/;
const EDGE_PUNCT_END = /[.,;:!?)"'»”]+$/;

/**
 * The wrong part of a quote, as offsets inside it: the quote's words that the fix changes (common
 * leading and trailing words removed). When the fix only adds words (an omission) or rewrites
 * everything, the whole quote. Sentence punctuation at the edges is dropped ("482,000." → "482,000").
 */
export function focusInQuote(quote: string, fix: string): Range {
  const q = tokens(quote);
  const f = tokens(fix);
  let p = 0;
  while (p < q.length && p < f.length && q[p].key === f[p].key) p++;
  let s = 0;
  while (s < q.length - p && s < f.length - p && q[q.length - 1 - s].key === f[f.length - 1 - s].key) s++;
  const from = p;
  const to = q.length - s;
  if (to <= from || (from === 0 && to === q.length)) return [0, quote.length];
  let a = q[from].start;
  let b = q[to - 1].end;
  const text = quote.slice(a, b);
  const lead = EDGE_PUNCT_START.exec(text)?.[0].length ?? 0;
  const trail = EDGE_PUNCT_END.exec(text)?.[0].length ?? 0;
  if (lead + trail < text.length) {
    a += lead;
    b -= trail;
  }
  return [a, b];
}

/** Error fields the grader reads; `quote`/`fix` let it derive the focus when it is not stored. */
export interface GradableError {
  start: number;
  end: number;
  quote?: string;
  fix?: string;
  type?: string;
  focusStart?: number;
  focusEnd?: number;
}

/** Document offsets of the wrong part of an error: the stored focus, else derived from quote and fix. */
export function errorFocus(e: GradableError): Range {
  if (typeof e.focusStart === 'number' && typeof e.focusEnd === 'number' && e.focusStart >= e.start && e.focusEnd <= e.end && e.focusEnd > e.focusStart) {
    return [e.focusStart, e.focusEnd];
  }
  if (e.type === 'omission') return [e.start, e.end]; // what is missing has no words of its own: the whole line
  if (e.quote && e.fix && e.quote.length === e.end - e.start) {
    const [a, b] = focusInQuote(e.quote, e.fix);
    return [e.start + a, e.start + b];
  }
  return [e.start, e.end];
}

const PAD = /[.,$%£€−+\-/:]/;

/**
 * The focus widened by one adjacent punctuation character on each side (".5 мг", "$482,000", "12%"),
 * read from the quote, so a word-level selection next to a symbol still lands.
 */
function paddedFocus(e: GradableError, f: Range): Range {
  if (!e.quote || e.quote.length !== e.end - e.start) return f;
  const at = (i: number) => e.quote![i - e.start] ?? '';
  const a = f[0] > e.start && PAD.test(at(f[0] - 1)) ? f[0] - 1 : f[0];
  const b = f[1] < e.end && PAD.test(at(f[1])) ? f[1] + 1 : f[1];
  return [a, b];
}

export type RangeStatus = 'hit' | 'near' | 'too_broad' | 'false';

export interface RangeMark {
  start: number;
  end: number;
  status: RangeStatus;
  /** Indexes of the errors this highlight found. */
  errors: number[];
}

export interface SlipGrade {
  score: number;
  found: number;
  total: number;
  falseFlags: number;
  flags: RepFlag[];
  ranges: Range[];
  errorsFound: boolean[];
  /** Highlights that touch no mistake; the first is free ("Not on our list"). */
  falseRanges: Range[];
  /** Highlights that cover a mistake but are too long to count ("Narrow it down to the wrong part"). */
  tooBroad: Range[];
  /** Every graded highlight with its status, in document order. */
  marks: RangeMark[];
  /** The wrong part of each error, aligned with the errors. */
  focus: Range[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Spot-the-slip grading. Each error has a focus: the exact wrong part. A highlight finds an error when
 * it overlaps the focus by at least one character (adjacent punctuation tolerated) and is not longer
 * than max(3 × focus, quote + 40) characters; a longer one is `too_broad` and finds nothing. A
 * highlight inside a quote but off its focus is `near`: no credit, no penalty. A highlight that touches
 * no quote is false: the first is free, each further one costs 0.15. Selecting more than 35% of the
 * document scores 0 (`over_selected`).
 */
export function gradeSlip(errors: readonly GradableError[], rawRanges: readonly Range[], docLength: number): SlipGrade {
  const ranges = mergeRanges(rawRanges, docLength);
  const focus = errors.map(errorFocus);
  const errorsFound = errors.map(() => false);
  const marks: RangeMark[] = ranges.map((r) => {
    const hits: number[] = [];
    let broad = false;
    let near = false;
    errors.forEach((e, i) => {
      const f = focus[i];
      if (overlap(r, paddedFocus(e, f)) > 0) {
        const limit = Math.max(BROAD_FACTOR * (f[1] - f[0]), e.end - e.start + BROAD_SLACK);
        if (r[1] - r[0] > limit) broad = true;
        else hits.push(i);
      } else if (overlap(r, [e.start, e.end]) > 0) near = true;
    });
    for (const i of hits) errorsFound[i] = true;
    const status: RangeStatus = hits.length ? 'hit' : broad ? 'too_broad' : near ? 'near' : 'false';
    return { start: r[0], end: r[1], status, errors: hits };
  });
  const falseRanges = marks.filter((m) => m.status === 'false').map((m): Range => [m.start, m.end]);
  const tooBroad = marks.filter((m) => m.status === 'too_broad').map((m): Range => [m.start, m.end]);
  const found = errorsFound.filter(Boolean).length;
  const total = errors.length;
  const selected = ranges.reduce((n, r) => n + (r[1] - r[0]), 0);
  const flags: RepFlag[] = [];
  if (tooBroad.length) flags.push('too_broad');
  let score: number;
  if (docLength > 0 && selected > OVER_SELECTED * docLength) {
    flags.push('over_selected');
    score = 0;
  } else {
    score = total ? Math.max(0, found / total - FALSE_PENALTY * Math.max(0, falseRanges.length - 1)) : 0;
  }
  return { score: round2(score), found, total, falseFlags: falseRanges.length, flags, ranges, errorsFound, falseRanges, tooBroad, marks, focus };
}

// ---------------------------------------------------------------------------------------------
// Rubrics (delegate, edge)

/** Lower-case, straight quotes, single spaces: the form in which quotes are compared with user text. */
export function looseText(s: string): string {
  return normalizeDocument(s).toLowerCase().replace(/[.,;:!?…"'«»()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when `quote` (≥ 2 words) appears in `text`, ignoring case, punctuation and spacing. */
export function quoteIn(text: string, quote: string | null | undefined): boolean {
  if (!quote) return false;
  const q = looseText(quote);
  if (q.split(' ').filter(Boolean).length < 2 && q.length < 6) return false;
  return looseText(text).includes(q);
}

/** The exact substring of `text` that `quote` refers to (for highlighting), or null. */
export function locateLoose(text: string, quote: string): Range | null {
  const q = looseText(quote);
  if (!q) return null;
  // map each char of text to its loose form position
  const chars: { ch: string; i: number }[] = [];
  let prevSpace = true;
  const src = text;
  for (let i = 0; i < src.length; i++) {
    let c = src[i].toLowerCase();
    if (/[\s.,;:!?…"'«»()‘’“”]/.test(c)) c = ' ';
    if (c === ' ') {
      if (prevSpace) continue;
      prevSpace = true;
    } else prevSpace = false;
    chars.push({ ch: c, i });
  }
  const flat = chars.map((c) => c.ch).join('');
  const at = flat.indexOf(q);
  if (at < 0) return null;
  return [chars[at].i, chars[at + q.length - 1].i + 1];
}

export function rubricScore(criteria: readonly { status: CriterionStatus }[]): number {
  if (!criteria.length) return 0;
  const sum = criteria.reduce((n, c) => n + (c.status === 'met' ? 1 : c.status === 'partly' ? 0.5 : 0), 0);
  return sum / criteria.length;
}

/** Delegate: criteria × 0.7 + caught traps × 0.3. */
export function delegateScore(criteria: readonly { status: CriterionStatus }[], trapsCaught: number, trapsTotal: number): number {
  const traps = trapsTotal > 0 ? Math.min(1, trapsCaught / trapsTotal) : 0;
  return round2(rubricScore(criteria) * 0.7 + traps * 0.3);
}

export function edgeScore(criteria: readonly { status: CriterionStatus }[]): number {
  return round2(rubricScore(criteria));
}

/** Highest Human edge score after a harmful move (unsafe, dishonest, non-compliant or unethical). */
export const HARM_CAP = 0.4;

/**
 * Applies a harmful move found by the grader (its quote already checked in the person's replies): the
 * criterion it breaks becomes missed with the reason as its note, and the score is capped at 0.4.
 */
export function applyHarm(
  criteria: readonly CriterionGrade[],
  harm: { quote: string; why: string; criterionId: string | null } | undefined,
): { criteria: CriterionGrade[]; harm?: { quote: string; why: string }; cap: (score: number) => number } {
  if (!harm) return { criteria: [...criteria], cap: (s) => s };
  return {
    criteria: criteria.map((c) => (c.id === harm.criterionId ? { id: c.id, status: 'missed', note: harm.why } : c)),
    harm: { quote: harm.quote, why: harm.why },
    cap: (s) => Math.min(s, HARM_CAP),
  };
}

/**
 * Keeps model grades honest: a met/partly criterion needs a quote that really is in the user's text,
 * otherwise it becomes missed. Unknown ids are dropped, missing ids are added as missed.
 */
export function verifyCriteria(
  rubric: readonly { id: string }[],
  graded: readonly { id: string; status: CriterionStatus; quote: string | null; note?: string | null }[],
  userText: string,
): CriterionGrade[] {
  const byId = new Map(graded.map((g) => [g.id, g]));
  return rubric.map((c) => {
    const g = byId.get(c.id);
    const note = g?.note?.trim() || undefined;
    if (!g || g.status === 'missed') return { id: c.id, status: 'missed', ...(note ? { note } : {}) };
    if (!quoteIn(userText, g.quote)) return { id: c.id, status: 'missed', ...(note ? { note } : {}) };
    return { id: c.id, status: g.status, quote: g.quote!.trim(), ...(note ? { note } : {}) };
  });
}

/** Grading without the model: a criterion is met when one of its keywords occurs in the user's text. */
export function keywordCriteria(rubric: readonly RubricItem[], userText: string): CriterionGrade[] {
  const sentences = normalizeDocument(userText).split(/(?<=[.!?\n])\s+/).filter(Boolean);
  return rubric.map((c) => {
    for (const k of c.keywords) {
      const hit = sentences.find((s) => containsWord(s, k));
      if (hit) return { id: c.id, status: 'met', quote: hit.trim().slice(0, 200) };
    }
    return { id: c.id, status: 'missed' };
  });
}

/** Case-insensitive match of a keyword at word boundaries (works for Cyrillic and numbers like "50 mg"). */
export function containsWord(text: string, keyword: string): boolean {
  return keywordSpots(text, keyword).length > 0;
}

export function keywordSpots(text: string, keyword: string): Range[] {
  const k = keyword.trim().toLowerCase();
  if (k.length < 2) return [];
  const t = text.toLowerCase();
  const out: Range[] = [];
  const isW = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const i of occurrences(t, k)) {
    const before = t[i - 1];
    const after = t[i + k.length];
    if (isW(k[0]) && isW(before)) continue;
    if (isW(k[k.length - 1]) && isW(after)) continue;
    out.push([i, i + k.length]);
  }
  return out;
}

const SHINGLE = 8;
function shingles(text: string): Set<string> {
  const w = looseText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}

/** True when the instruction pastes the input material (an 8-word run in common): keyword hits there prove nothing. */
export function copiesInputs(instruction: string, inputs: string): boolean {
  const a = shingles(instruction);
  if (!a.size) return false;
  const b = shingles(inputs);
  for (const s of a) if (b.has(s)) return true;
  return false;
}

const VALUE_RE = /\$?\d[\d.,/]*\s?(?:[a-zA-Zа-яА-ЯёЁ%°µ]+(?:\/[a-zA-Z]+)?)?/g;

/**
 * Terms that mark a trap: its keywords plus the number-with-unit inside each ("Lasix 20 mg" → "20 mg"),
 * because people write the conflicting value, not the model's exact phrase.
 */
export function trapTerms(trap: Pick<Trap, 'keywords'>): string[] {
  const out = new Set<string>();
  for (const k of trap.keywords) {
    const t = k.replace(/\s+/g, ' ').trim();
    if (t.length >= 2) out.add(t);
    for (const m of t.match(VALUE_RE) ?? []) if (m.trim().length >= 2 && /\D/.test(m.trim())) out.add(m.trim());
  }
  return [...out];
}

/**
 * A trap is caught when the instruction or the fix sentence names one of its terms (unless they just
 * paste the inputs), when a user highlight in the AI's result touches a place where a term occurs, or
 * when the grader found it named and its quote was verified in the person's text (`verified`).
 */
export function trapsCaught(
  traps: readonly Trap[],
  instruction: string,
  run: string,
  reviewRanges: readonly Range[],
  inputs: string,
  fix = '',
  verified: readonly string[] = [],
): string[] {
  const own = [instruction, fix].filter((s) => s && !copiesInputs(s, inputs)).join('\n');
  const ranges = mergeRanges(reviewRanges, run.length, 40);
  return traps
    .filter((t) => {
      if (verified.includes(t.id)) return true;
      const terms = trapTerms(t);
      if (terms.some((k) => containsWord(own, k))) return true;
      const spots = terms.flatMap((k) => keywordSpots(run, k));
      return spots.some((s) => ranges.some((r) => overlap(r, s) > 0));
    })
    .map((t) => t.id);
}

/** Where each trap sits: its two evidence quotes and its keywords in the inputs, its keywords in the AI's result. */
export function trapSpots(traps: readonly TrapFull[], inputs: string, run: string | undefined): TrapSpot[] {
  const out: TrapSpot[] = [];
  for (const t of traps) {
    for (const q of t.evidence ?? []) {
      const at = inputs.indexOf(q);
      const r = at >= 0 ? ([at, at + q.length] as Range) : locateLoose(inputs, q);
      if (r) out.push({ trapId: t.id, where: 'inputs', start: r[0], end: r[1] });
    }
    for (const k of trapTerms(t)) {
      for (const [start, end] of keywordSpots(inputs, k)) out.push({ trapId: t.id, where: 'inputs', start, end });
      if (run) for (const [start, end] of keywordSpots(run, k)) out.push({ trapId: t.id, where: 'run', start, end });
    }
  }
  // a value inside a longer keyword ("20 mg" in "Lasix 20 mg") is one spot, not two
  const kept = out.filter(
    (s, i) => !out.some((o, j) => j !== i && o.trapId === s.trapId && o.where === s.where && o.start <= s.start && o.end >= s.end && (o.end - o.start > s.end - s.start || j < i)),
  );
  return kept.sort((a, b) => (a.where === b.where ? a.start - b.start : a.where === 'inputs' ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// Days, difficulty, streak

/** YYYY-MM-DD of `date` in `tz` (UTC when the zone is missing or invalid). */
export function localDay(date: Date, tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Streak 0–2 → 1, 3–9 → 2, 10+ → 3. */
export function difficultyFor(streak: number): 1 | 2 | 3 {
  return streak >= 10 ? 3 : streak >= 3 ? 2 : 1;
}

/** Planted mistakes: 1 + difficulty (2..4). */
export function slipErrorCount(difficulty: 1 | 2 | 3): number {
  return 1 + difficulty;
}

export const STREAK_DAYS_KEPT = 14;

/**
 * Streak after a counted rep on `day`: same day → unchanged, the day after the last one → +1, otherwise 1.
 * `days` keeps the counted days of the last 14 days.
 */
export function applyStreak(streak: Profile['streak'], day: string): Profile['streak'] {
  if (streak.lastDay === day) return streak;
  const current = streak.lastDay && daysBetween(streak.lastDay, day) === 1 ? streak.current + 1 : 1;
  const from = addDays(day, -(STREAK_DAYS_KEPT - 1));
  const days = [...new Set([...streak.days, day])].filter((d) => d >= from && d <= day).sort();
  return { ...streak, current, best: Math.max(streak.best, current), lastDay: day, days };
}

/** The streak as it reads today: a streak whose last day is before yesterday is broken (current 0). */
export function streakAsOf(streak: Profile['streak'], today: string): Profile['streak'] {
  if (!streak.lastDay) return { ...streak, current: 0 };
  const gap = daysBetween(streak.lastDay, today);
  return gap <= 1 ? streak : { ...streak, current: 0 };
}

// ---------------------------------------------------------------------------------------------
// Seeded randomness

/** 32-bit FNV-1a. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: deterministic stream in [0, 1). */
export function rng(seed: string): () => number {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
// Task choice

export const REPEAT_WINDOW_DAYS = 5;

/** Category groups in order of preference: the first is the type's own, the rest are the nearest ones. */
const CATEGORY_GROUPS: Record<RepType, Category[][]> = {
  slip: [['ai_does', 'ai_speeds'], ['no_data'], ['human_edge']],
  delegate: [['ai_does', 'ai_speeds'], ['no_data'], ['human_edge']],
  edge: [['human_edge'], ['no_data'], ['ai_speeds', 'ai_does']],
};

/** Categories a rep type is meant for. */
export function categoriesFor(type: RepType): Category[] {
  return CATEGORY_GROUPS[type][0];
}

export interface TaskChoiceInput {
  tasks: readonly Pick<OccTask, 'id' | 'evidence'>[];
  shares: readonly WeekShare[];
  repLog: Profile['repLog'];
  type: RepType;
  day: string;
  seed: string;
}

/**
 * The task for a rep: from the person's week, weighted by share; slip and delegate prefer ai_does/ai_speeds,
 * edge prefers human_edge, falling back to the nearest category; tasks used in the last 5 days are skipped
 * while others exist. Without a week the largest-weight task of the occupation wins. Deterministic for a seed.
 */
export function chooseTask(input: TaskChoiceInput): string | null {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const week = input.shares.filter((s) => byId.has(s.taskId) && s.share > 0);
  if (!week.length) return input.tasks[0]?.id ?? null;
  const recent = new Set(
    input.repLog.filter((r) => daysBetween(r.day, input.day) < REPEAT_WINDOW_DAYS && daysBetween(r.day, input.day) >= 0).map((r) => r.taskId),
  );
  const rand = rng(input.seed);
  const pick = (pool: readonly WeekShare[]) => {
    const total = pool.reduce((n, s) => n + s.share, 0);
    let x = rand() * total;
    for (const s of pool) {
      x -= s.share;
      if (x < 0) return s.taskId;
    }
    return pool[pool.length - 1].taskId;
  };
  for (const allowRecent of [false, true]) {
    for (const cats of CATEGORY_GROUPS[input.type]) {
      const pool = week.filter((s) => cats.includes(byId.get(s.taskId)!.evidence.category) && (allowRecent || !recent.has(s.taskId)));
      if (pool.length) return pick(pool);
    }
  }
  return [...week].sort((a, b) => b.share - a.share)[0].taskId;
}

// ---------------------------------------------------------------------------------------------
// AI or me?

export const AI_OR_ME_SIZE = 5;
export const WEEK_HOURS_TOTAL = 40;

const isAiCat = (c: Category) => c === 'ai_does' || c === 'ai_speeds';

/** Hours a week from a share, to the half hour. */
export function hoursOfShare(share: number): number {
  return Math.round(((share / 100) * WEEK_HOURS_TOTAL) * 2) / 2;
}

/**
 * Clear-cut tasks only, so every answer can be defended from the data:
 * - "ai": observed in real AI use at work, or rated by research as doable by language models (theory >= 0.75);
 * - "human": not seen in AI usage (not observed, not seen rarely) and either research rates it low
 *   (theory <= 0.25), or it is physical, or it is work with people.
 * Unobserved middle ratings (theory 0.5) and rarely seen tasks are left out: either answer is arguable.
 */
export function aiOrMeAnswer(task: Pick<OccTask, 'evidence'>): 'ai' | 'human' | null {
  const e = task.evidence;
  if (!e.observed && e.seenRarely) return null; // published but rare: neither answer is clean
  if (isAiCat(e.category) && (e.observed || e.theory >= 0.75)) return 'ai';
  if (e.observed || e.seenRarely || e.theory >= 0.75 || e.category === 'ai_does') return null;
  if (e.theory <= 0.25 || e.physical === true || e.peopleWork === true) return 'human';
  return null;
}

/**
 * Fact for a card: only what the data says. Keys (the Today screen renders them):
 * - today.aiOrMe.fact.observed      { automation }  "Seen in AI use at work: in {automation}% of those conversations AI does the task itself"
 * - today.aiOrMe.fact.used          { }             "Seen in AI use at work"
 * - today.aiOrMe.fact.research_high { }            "Research rates it as work language models can do; not seen in AI usage yet"
 * - today.aiOrMe.fact.hands_on      { }             "Hands-on work; not seen in AI usage yet"
 * - today.aiOrMe.fact.people        { }             "Work with people; not seen in AI usage yet"
 * - today.aiOrMe.fact.not_seen      { }             "Not seen in AI usage yet; research rates it low"
 * - today.aiOrMe.fact.no_data       { }             "No data yet on this task" (unscored filler)
 * Every fact gets `hours` when the task is in the person's week ("You spend {hours} h a week on this").
 */
export function aiOrMeFact(task: Pick<OccTask, 'evidence'>, share: number | undefined): AiOrMeCard['fact'] {
  const e = task.evidence;
  const params: Record<string, number | string> = {};
  if (share && share > 0) params.hours = hoursOfShare(share);
  let key: string;
  const answer = aiOrMeAnswer(task);
  if (answer === 'ai') {
    if (e.observed && e.aeiAutomation !== null) {
      key = 'observed';
      params.automation = Math.round(e.aeiAutomation * 100);
    } else if (e.observed) key = 'used';
    else key = 'research_high';
  } else if (answer === 'human') key = e.physical ? 'hands_on' : e.peopleWork ? 'people' : 'not_seen';
  else key = 'no_data';
  return { key: `today.aiOrMe.fact.${key}`, params };
}

const STOPWORDS = new Set(['and', 'or', 'the', 'for', 'with', 'from', 'that', 'such', 'other', 'into', 'their', 'about', 'using', 'including']);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  );
}

/** Jaccard similarity of content words: near-duplicate task texts score >= NEAR_DUPLICATE (0.3: the closest Accountants pair is 0.36, the next 0.25). */
export function textSimilarity(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

export const NEAR_DUPLICATE = 0.3;

/** Evidence strength for ordering "ai" cards: observed first. */
const aiStrength = (t: Pick<OccTask, 'evidence'>) => (t.evidence.observed ? 2 : 1);

/**
 * Round of the day, deterministic for (profileId, day): 2 "AI" and 2 "human" cards from clear-cut tasks
 * (aiOrMeAnswer), 1 more from either group, tasks of the person's week first, no two near-duplicate texts.
 * When the clear-cut tasks run out the round is shorter; no_data tasks may fill it, unscored.
 */
export function buildAiOrMeRound(
  bundle: Pick<OccupationBundle, 'tasks'>,
  shares: readonly WeekShare[],
  profileId: string,
  day: string,
  texts: Record<string, string>,
): AiOrMeRoundFull {
  const seed = `${profileId}:${day}:ai-or-me`;
  const rand = rng(seed);
  const shareOf = new Map(shares.map((s) => [s.taskId, s.share]));
  const order = (pool: readonly OccTask[], strength: (t: OccTask) => number) =>
    shuffle(pool, rand).sort((a, b) => strength(b) - strength(a) || Number(shareOf.has(b.id)) - Number(shareOf.has(a.id)));
  const ai = order(bundle.tasks.filter((t) => aiOrMeAnswer(t) === 'ai'), aiStrength);
  const human = order(bundle.tasks.filter((t) => aiOrMeAnswer(t) === 'human'), () => 0);
  const none = order(bundle.tasks.filter((t) => t.evidence.category === 'no_data'), () => 0);

  const chosen: { task: OccTask; answer: 'ai' | 'human'; counted: boolean }[] = [];
  const distinct = (t: OccTask) => chosen.every((c) => textSimilarity(c.task.text, t.text) < NEAR_DUPLICATE);
  const take = (pool: OccTask[], answer: 'ai' | 'human', n: number, counted = true) => {
    let added = 0;
    while (added < n && pool.length) {
      const t = pool.shift()!;
      if (!distinct(t)) continue;
      chosen.push({ task: t, answer, counted });
      added++;
    }
  };
  take(ai, 'ai', 2);
  take(human, 'human', 2);
  for (const g of rand() < 0.5 ? (['ai', 'human'] as const) : (['human', 'ai'] as const)) {
    if (chosen.length >= AI_OR_ME_SIZE) break;
    take(g === 'ai' ? ai : human, g, 1);
  }
  for (const [pool, answer] of [[ai, 'ai'], [human, 'human']] as const) take(pool, answer, AI_OR_ME_SIZE - chosen.length);
  take(none, 'human', AI_OR_ME_SIZE - chosen.length, false);

  const cards: AiOrMeCard[] = shuffle(chosen, rand).map(({ task, answer, counted }) => ({
    taskId: task.id,
    text: texts[task.id] ?? task.text,
    answer,
    counted,
    fact: aiOrMeFact(task, shareOf.get(task.id)),
  }));
  const roundId = `${day}-${hash32(seed + cards.map((c) => c.taskId).join(',')).toString(36)}`;
  return { roundId, day, cards };
}

/** Correct per card; unanswered cards are wrong; uncounted cards are reported but not scored. */
export function scoreAiOrMe(cards: readonly Pick<AiOrMeCard, 'answer' | 'counted'>[], answers: readonly (string | null)[]) {
  const correct = cards.map((c, i) => answers[i] === c.answer);
  const right = cards.reduce((n, c, i) => n + (c.counted && correct[i] ? 1 : 0), 0);
  const total = cards.filter((c) => c.counted).length;
  return { correct, right, total };
}

// ---------------------------------------------------------------------------------------------
// Misc

export const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', ru: 'Russian', kk: 'Kazakh' };
