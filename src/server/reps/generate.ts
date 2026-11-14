import {
  hash32,
  keywordCriteria,
  keywordSpots,
  normalizeDocument,
  normalizeQuote,
  occurrences,
  quoteIn,
  slipErrorCount,
  toLightMarkup,
  trapTerms,
  containsWord,
  validateSlip,
  verifyCriteria,
  wordCount,
  type CriterionGrade,
  type RubricItem,
  type TrapFull,
} from '@/domain/reps';
import type { Locale } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { AiError, callModel, isAiError } from '@/server/ai/client';
import { repDelegatePrompt, repDelegateRunPrompt, repDelegateRunSchema, repDelegateSchema, type RepDelegateOutput } from '@/server/ai/prompts/rep-delegate';
import { repEdgePrompt, repEdgeReplyPrompt, repEdgeReplySchema, repEdgeSchema, type RepEdgeOutput, type RepEdgeReply } from '@/server/ai/prompts/rep-edge';
import { repGradeDelegatePrompt, repGradeDelegateSchema, repGradeEdgePrompt, repGradeEdgeSchema } from '@/server/ai/prompts/rep-grade';
import { repSlipPrompt, repSlipSchema, type RepSlipOutput } from '@/server/ai/prompts/rep-slip';
import { repVerifyDelegatePrompt, repVerifySchema, repVerifySlipPrompt, type RepVerifyOutput } from '@/server/ai/prompts/rep-verify';
import type { BankDelegate, BankEdge, BankEntry, BankSlip } from './bank';
import { plannedTypes } from './error-types';
import { weakOmissionProblems } from './generate-checks';

/**
 * Generation, validation, verification and grading with the model. Each generator returns a BankEntry
 * that passed the code checks and the independent `rep.verify` review — the same object the bank
 * script (03.3) saves and the live path turns into a rep — or throws AiError ('invalid_output' when
 * every attempt failed).
 */

export interface GenerateInput {
  occupationCode: string;
  /** Occupation title in English (O*NET). */
  occupation: string;
  taskId: string;
  /** Full task text (English O*NET text is fine for any locale). */
  task: string;
  taskShort: string;
  locale: Locale;
  difficulty: 1 | 2 | 3;
  seed: string;
  actor?: Actor;
  signal?: AbortSignal;
}

export interface Generated<E extends BankEntry> {
  entry: E;
  /** Generation attempts used (1 = passed on the first attempt). */
  attempts: number;
  costUsd: number;
  /** Problems of the rejected attempts (code checks and verifier), for the bank report. */
  rejected: string[][];
}

/** Attempts after the first one when the checks or the verifier reject the output. */
export const SLIP_RETRIES = 2;
const DELEGATE_RETRIES = 2;
const EDGE_RETRIES = 1;

// ---------------------------------------------------------------------------------------------
// Verifier

export interface Verification {
  ok: boolean;
  problems: string[];
  costUsd: number;
}

/**
 * Turns the verifier's answer into problems: every declared item must be real and unambiguous, and an
 * undeclared error counts only when its quote is really in the material (the verifier can misquote).
 */
export function verificationProblems(out: RepVerifyOutput, declared: string[], material: string, noun: 'Mistake' | 'Trap'): string[] {
  const problems: string[] = [];
  declared.forEach((label, i) => {
    const item = out.items.find((x) => x.index === i);
    if (!item) problems.push(`${noun} ${i + 1} ("${label}") was not confirmed by the reviewer.`);
    else if (!item.real) problems.push(`${noun} ${i + 1} ("${label}") is not a real ${noun === 'Trap' ? 'contradiction' : 'mistake'}: ${item.reason}`);
    else if (!item.unambiguous) problems.push(`${noun} ${i + 1} ("${label}") is debatable for a specialist: ${item.reason}`);
  });
  for (const o of out.otherErrors) {
    if (quoteIn(material, o.quote)) problems.push(`Unplanned error at "${o.quote}": ${o.problem} Fix it so that only the declared ${noun === 'Trap' ? 'traps' : 'mistakes'} remain.`);
  }
  return problems;
}

async function verifySlipContent(occupation: string, slip: BankSlip['slip'], actor?: Actor): Promise<Verification> {
  const { data, usage } = await callModel({
    op: 'rep.verify',
    schema: repVerifySchema,
    system: repVerifySlipPrompt.system(),
    user: repVerifySlipPrompt.user({ occupation, document: slip.document, errors: slip.errors }),
    locale: 'en',
    maxTokens: 6000,
    temperature: 0,
    reasoning: 'low',
    actor,
  });
  const problems = verificationProblems(data, slip.errors.map((e) => e.quote), slip.document, 'Mistake');
  return { ok: problems.length === 0, problems, costUsd: usage.costUsd };
}

async function verifyDelegateContent(occupation: string, d: BankDelegate['delegate'], actor?: Actor): Promise<Verification> {
  const traps = d.traps.map((t) => ({ description: t.description, evidence: (t as TrapFull).evidence ?? [] }));
  const { data, usage } = await callModel({
    op: 'rep.verify',
    schema: repVerifySchema,
    system: repVerifyDelegatePrompt.system(),
    user: repVerifyDelegatePrompt.user({ occupation, inputs: d.inputs, traps }),
    locale: 'en',
    maxTokens: 6000,
    temperature: 0,
    reasoning: 'low',
    actor,
  });
  const problems = verificationProblems(data, d.traps.map((t) => t.description), d.inputs, 'Trap');
  return { ok: problems.length === 0, problems, costUsd: usage.costUsd };
}

/**
 * Independent review of a generated (or banked) rep: Spot the slip — every planted mistake is real and
 * unambiguous and nothing else is wrong; Delegate — every trap is a real contradiction and the inputs are
 * otherwise consistent. Human edge has no factual claims to check (always ok). For the bank script.
 */
export async function verifyEntry(entry: BankEntry, opts: { occupation?: string; actor?: Actor } = {}): Promise<Verification> {
  const occupation = opts.occupation ?? entry.occupationCode;
  if (entry.type === 'slip') return verifySlipContent(occupation, entry.slip, opts.actor);
  if (entry.type === 'delegate') {
    const grounding = groundingProblems(entry.delegate.traps as TrapFull[], entry.delegate.inputs);
    if (grounding.length) return { ok: false, problems: grounding, costUsd: 0 };
    return verifyDelegateContent(occupation, entry.delegate, opts.actor);
  }
  return { ok: true, problems: [], costUsd: 0 };
}

// ---------------------------------------------------------------------------------------------
// Spot the slip

export async function generateSlip(input: GenerateInput): Promise<Generated<BankSlip>> {
  const n = slipErrorCount(input.difficulty);
  const types = plannedTypes(input.occupationCode, n, hash32(input.seed) % 3);
  let retry: { previous: RepSlipOutput; problems: string[] } | null = null;
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 1 + SLIP_RETRIES; attempt++) {
    const { data, usage }: { data: RepSlipOutput; usage: { costUsd: number } } = await callModel({
      op: 'rep.slip',
      schema: repSlipSchema,
      system: repSlipPrompt.system(input.locale),
      user: repSlipPrompt.user({ occupation: input.occupation, task: input.task, taskShort: input.taskShort, locale: input.locale, difficulty: input.difficulty, types, seed: input.seed, retry }),
      locale: input.locale,
      maxTokens: 5000,
      temperature: 0.9,
      reasoning: 'minimal',
      actor: attempt === 1 ? input.actor : undefined,
      signal: input.signal,
    });
    cost += usage.costUsd;
    const checked = validateSlip(data, { n, types: [...new Set(types)] });
    let problems = checked.ok ? weakOmissionProblems(checked.content.slip.errors) : checked.problems;
    if (checked.ok && !problems.length) {
      const c = checked.content;
      const v = await verifySlipContent(input.occupation, c.slip);
      cost += v.costUsd;
      if (v.ok) {
        return {
          entry: { type: 'slip', occupationCode: input.occupationCode, taskId: input.taskId, locale: input.locale, difficulty: input.difficulty, title: c.title, brief: c.brief, docType: c.docType, slip: c.slip },
          attempts: attempt,
          costUsd: cost,
          rejected,
        };
      }
      problems = v.problems;
    }
    rejected.push(problems);
    console.info(`[reps] rep.slip attempt ${attempt} rejected: ${problems.slice(0, 3).join(' | ').slice(0, 400)}`);
    retry = { previous: data, problems };
  }
  throw new AiError('invalid_output', `rep.slip failed checks ${1 + SLIP_RETRIES} times`, { op: 'rep.slip' });
}

// ---------------------------------------------------------------------------------------------
// Delegate

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'mg', 'and/or']);

/** Keywords that really occur in `inputs` and are specific (at most 3 occurrences, not a stop word). */
function trapKeywords(keywords: string[], inputs: string): string[] {
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.replace(/\s+/g, ' ').trim();
    if (k.length < 2 || STOP.has(k.toLowerCase())) continue;
    const n = keywordSpots(inputs, k).length;
    if (n >= 1 && n <= 3 && !out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k);
  }
  return out.slice(0, 4);
}

function rubric(items: { text: string; keywords: string[] }[], max: number): RubricItem[] {
  return items
    .filter((c) => c.text.trim())
    .slice(0, max)
    .map((c, i) => ({
      id: `c${i + 1}`,
      text: c.text.trim(),
      keywords: [...new Set(c.keywords.map((k) => k.replace(/\s+/g, ' ').trim()).filter((k) => k.length >= 2))].slice(0, 8),
    }));
}

/** The exact text of a quote in `inputs` (case-insensitive fallback), or null. */
function findIn(inputs: string, quote: string): string | null {
  const q = normalizeQuote(quote);
  if (!q) return null;
  if (occurrences(inputs, q).length) return q;
  const at = inputs.toLowerCase().indexOf(q.toLowerCase());
  return at >= 0 ? inputs.slice(at, at + q.length) : null;
}

/** Each trap must be grounded: two different verbatim quotes of the inputs. */
export function groundingProblems(traps: readonly TrapFull[], inputs: string): string[] {
  const problems: string[] = [];
  traps.forEach((t, i) => {
    const ev = t.evidence ?? [];
    if (ev.length !== 2 || normalizeQuote(ev[0]).toLowerCase() === normalizeQuote(ev[1]).toLowerCase()) {
      problems.push(`Trap ${i + 1}: give exactly 2 different evidence quotes, the two places in the inputs that contradict each other.`);
      return;
    }
    for (const q of ev) if (!findIn(inputs, q)) problems.push(`Trap ${i + 1}: the evidence "${q}" is not in the inputs word for word; copy it exactly.`);
  });
  return problems;
}

export type DelegateValidation = { ok: true; content: Omit<BankDelegate, 'type' | 'occupationCode' | 'taskId' | 'locale' | 'difficulty'> } | { ok: false; problems: string[] };

/**
 * Pure check of a generated Delegate scenario: inputs normalised to light markup; traps grounded in two
 * verbatim, different evidence quotes; keywords kept only when they are in the inputs; the exemplar
 * present and not naming the traps.
 */
export function validateDelegate(out: RepDelegateOutput): DelegateValidation {
  const problems: string[] = [];
  const inputs = normalizeDocument(toLightMarkup(out.inputs ?? ''));
  const words = wordCount(inputs);
  if (words < 60 || words > 260) problems.push(`inputs has ${words} words; it must have 80–200.`);
  for (const f of ['title', 'brief', 'scenario', 'goal'] as const) if (!out[f]?.trim()) problems.push(`${f} is empty.`);
  const criteria = rubric(out.criteria ?? [], 6);
  if (criteria.length < 4) problems.push(`There must be 4–6 criteria; you gave ${criteria.length}.`);
  const traps: TrapFull[] = [];
  (out.traps ?? []).slice(0, 2).forEach((t, i) => {
    if (!t.description?.trim()) problems.push(`Trap ${i + 1}: description is empty.`);
    const evidence = (t.evidence ?? []).map((q) => findIn(inputs, q) ?? q);
    const keywords = trapKeywords(t.keywords ?? [], inputs);
    if (!keywords.length) {
      problems.push(`Trap ${i + 1}: none of its keywords (${(t.keywords ?? []).join(', ')}) appears in the inputs verbatim and at most 3 times; copy the exact conflicting value or item from the inputs.`);
      return;
    }
    traps.push({ id: `t${i + 1}`, description: (t.description ?? '').trim(), keywords, evidence });
  });
  if ((out.traps ?? []).length < 2) problems.push('There must be exactly 2 traps.');
  problems.push(...groundingProblems(traps, inputs));
  const exemplar = (out.exemplar ?? '').replace(/\s+/g, ' ').trim();
  const exWords = wordCount(exemplar);
  if (exWords < 25 || exWords > 160) problems.push(`exemplar has ${exWords} words; it must have 40–110.`);
  const named = traps.flatMap((t) => trapTerms(t).filter((k) => /\d/.test(k) && containsWord(exemplar, k)));
  if (named.length) problems.push(`The exemplar names trap values (${[...new Set(named)].join(', ')}); phrase its checks generally.`);
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    content: { title: out.title.trim(), brief: out.brief.trim(), delegate: { scenario: out.scenario.trim(), inputs, goal: out.goal.trim(), criteria, traps, exemplar } },
  };
}

export async function generateDelegate(input: GenerateInput): Promise<Generated<BankDelegate>> {
  let retry: { previous: RepDelegateOutput; problems: string[] } | null = null;
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 1 + DELEGATE_RETRIES; attempt++) {
    const { data, usage }: { data: RepDelegateOutput; usage: { costUsd: number } } = await callModel({
      op: 'rep.delegate',
      schema: repDelegateSchema,
      system: repDelegatePrompt.system(input.locale),
      user: repDelegatePrompt.user({ occupation: input.occupation, task: input.task, locale: input.locale, seed: input.seed, retry }),
      locale: input.locale,
      maxTokens: 5000,
      temperature: 0.8,
      reasoning: 'minimal',
      actor: attempt === 1 ? input.actor : undefined,
      signal: input.signal,
    });
    cost += usage.costUsd;
    const checked = validateDelegate(data);
    let problems = checked.ok ? [] : checked.problems;
    if (checked.ok) {
      const v = await verifyDelegateContent(input.occupation, checked.content.delegate);
      cost += v.costUsd;
      if (v.ok) {
        return {
          entry: { type: 'delegate', occupationCode: input.occupationCode, taskId: input.taskId, locale: input.locale, difficulty: input.difficulty, ...checked.content },
          attempts: attempt,
          costUsd: cost,
          rejected,
        };
      }
      problems = v.problems;
    }
    rejected.push(problems);
    console.info(`[reps] rep.delegate attempt ${attempt} rejected: ${problems.slice(0, 3).join(' | ').slice(0, 400)}`);
    retry = { previous: data, problems };
  }
  throw new AiError('invalid_output', 'rep.delegate failed checks', { op: 'rep.delegate' });
}

/** The AI following the person's instruction literally (temperature 0.3); output kept to light markup. */
export async function runDelegate(input: { inputs: string; instruction: string; locale: Locale; actor?: Actor; signal?: AbortSignal }): Promise<{ output: string; costUsd: number }> {
  const { data, usage } = await callModel({
    op: 'rep.delegate.run',
    schema: repDelegateRunSchema,
    system: repDelegateRunPrompt.system(input.locale),
    user: repDelegateRunPrompt.user({ instruction: input.instruction, inputs: input.inputs }),
    locale: input.locale,
    maxTokens: 2500,
    temperature: 0.3,
    reasoning: 'minimal',
    actor: input.actor,
    signal: input.signal,
  });
  const output = normalizeDocument(toLightMarkup(data.output));
  if (!output) throw new AiError('invalid_output', 'rep.delegate.run returned an empty result', { op: 'rep.delegate.run' });
  return { output, costUsd: usage.costUsd };
}

export interface RubricGrade {
  criteria: CriterionGrade[];
  summary?: string;
  fixFeedback?: string;
  /** Delegate: traps the person's instruction or fix asked for, quote verified in their text. */
  trapsAsked?: string[];
  /** Delegate: traps the AI's result pointed out by itself, quote verified in the result. */
  trapsFlaggedByAi?: string[];
  /** Edge: the harmful move, quote verified in the person's replies. */
  harm?: { quote: string; why: string; criterionId: string | null };
  /** true when the model was unavailable and keywords decided. */
  keywordGrade: boolean;
  costUsd: number;
}

/** rep.grade for Delegate; quotes are checked against the instruction, fix and result. Falls back to keyword grading. */
export async function gradeDelegate(input: {
  occupation: string;
  locale: Locale;
  scenario: string;
  goal: string;
  inputs: string;
  criteria: RubricItem[];
  traps: TrapFull[];
  instruction: string;
  run: string;
  highlighted: string[];
  fix: string;
  actor?: Actor;
}): Promise<RubricGrade> {
  try {
    const { data, usage } = await callModel({
      op: 'rep.grade',
      schema: repGradeDelegateSchema,
      system: repGradeDelegatePrompt.system(input.locale),
      user: repGradeDelegatePrompt.user({
        ...input,
        criteria: input.criteria.map(({ id, text }) => ({ id, text })),
        traps: input.traps.map(({ id, description }) => ({ id, description })),
      }),
      locale: input.locale,
      maxTokens: 3000,
      temperature: 0.1,
      reasoning: 'minimal',
      actor: input.actor,
    });
    const known = (id: string) => input.traps.some((x) => x.id === id);
    return {
      criteria: verifyCriteria(input.criteria, data.criteria, input.instruction),
      summary: data.summary.trim() || undefined,
      fixFeedback: data.fixFeedback?.trim() || undefined,
      trapsAsked: data.traps.filter((t) => t.asked && known(t.id) && (quoteIn(input.instruction, t.quote) || quoteIn(input.fix, t.quote))).map((t) => t.id),
      trapsFlaggedByAi: data.traps.filter((t) => t.aiFlagged && known(t.id) && quoteIn(input.run, t.runQuote)).map((t) => t.id),
      keywordGrade: false,
      costUsd: usage.costUsd,
    };
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.info(`[reps] rep.grade (delegate) unavailable: ${err.code}; keyword grading`);
    return { criteria: keywordCriteria(input.criteria, input.instruction), keywordGrade: true, costUsd: 0 };
  }
}

// ---------------------------------------------------------------------------------------------
// Human edge

export type EdgeValidation = { ok: true; content: Omit<BankEdge, 'type' | 'occupationCode' | 'taskId' | 'locale' | 'difficulty'> } | { ok: false; problems: string[] };

export function validateEdge(out: RepEdgeOutput): EdgeValidation {
  const problems: string[] = [];
  for (const f of ['title', 'brief', 'scenario', 'personaPublic', 'personaHidden', 'goal', 'opening'] as const) if (!out[f]?.trim()) problems.push(`${f} is empty.`);
  const criteria = rubric(out.criteria ?? [], 5);
  if (criteria.length < 4) problems.push(`There must be 4–5 criteria; you gave ${criteria.length}.`);
  const openingWords = wordCount(out.opening ?? '');
  if (openingWords > 90) problems.push(`opening has ${openingWords} words; at most 60.`);
  if (problems.length) return { ok: false, problems };
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  return {
    ok: true,
    content: {
      title: clean(out.title),
      brief: clean(out.brief),
      edge: {
        scenario: clean(out.scenario),
        personaPublic: clean(out.personaPublic),
        personaHidden: clean(out.personaHidden),
        goal: clean(out.goal),
        criteria,
        opening: clean(out.opening),
      },
    },
  };
}

export async function generateEdge(input: GenerateInput): Promise<Generated<BankEdge>> {
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 1 + EDGE_RETRIES; attempt++) {
    const { data, usage } = await callModel({
      op: 'rep.edge',
      schema: repEdgeSchema,
      system: repEdgePrompt.system(input.locale),
      user: repEdgePrompt.user({ occupation: input.occupation, task: input.task, locale: input.locale, seed: `${input.seed}${attempt > 1 ? `-${attempt}` : ''}` }),
      locale: input.locale,
      maxTokens: 3000,
      temperature: 0.9,
      reasoning: 'minimal',
      actor: attempt === 1 ? input.actor : undefined,
      signal: input.signal,
    });
    cost += usage.costUsd;
    const checked = validateEdge(data);
    if (checked.ok) {
      return {
        entry: { type: 'edge', occupationCode: input.occupationCode, taskId: input.taskId, locale: input.locale, difficulty: input.difficulty, ...checked.content },
        attempts: attempt,
        costUsd: cost,
        rejected,
      };
    }
    rejected.push(checked.problems);
  }
  throw new AiError('invalid_output', 'rep.edge failed validation', { op: 'rep.edge' });
}

export const EDGE_HISTORY = 8;
export const EDGE_REPLY_WORDS = 80;

/** The persona's next line, in character; history trimmed to the last 8 messages. */
export async function edgeReply(input: {
  occupation: string;
  locale: Locale;
  scenario: string;
  personaPublic: string;
  personaHidden: string;
  turns: { role: 'user' | 'persona'; text: string }[];
  actor?: Actor;
}): Promise<{ reply: string; mood: RepEdgeReply['mood']; costUsd: number }> {
  const { data, usage } = await callModel({
    op: 'rep.edge.reply',
    schema: repEdgeReplySchema,
    system: repEdgeReplyPrompt.system(input.locale),
    user: repEdgeReplyPrompt.user({ ...input, turns: input.turns.slice(-EDGE_HISTORY) }),
    locale: input.locale,
    maxTokens: 1200,
    temperature: 0.8,
    reasoning: 'minimal',
    actor: input.actor,
  });
  let reply = data.reply.replace(/\s+/g, ' ').trim();
  if (!reply) throw new AiError('invalid_output', 'rep.edge.reply returned an empty line', { op: 'rep.edge.reply' });
  const words = reply.split(' ');
  if (words.length > EDGE_REPLY_WORDS + 15) reply = `${words.slice(0, EDGE_REPLY_WORDS).join(' ').replace(/[,;:]$/, '')}…`;
  return { reply, mood: data.mood, costUsd: usage.costUsd };
}

/**
 * rep.grade for Human edge; criterion quotes are checked against the person's replies, and so is the
 * quote of a harmful move. Falls back to keyword grading (no harm check then).
 */
export async function gradeEdge(input: {
  occupation: string;
  locale: Locale;
  scenario: string;
  personaPublic: string;
  personaHidden: string;
  goal: string;
  criteria: RubricItem[];
  turns: { role: 'user' | 'persona'; text: string }[];
  endedEarly: boolean;
  actor?: Actor;
}): Promise<RubricGrade> {
  const userText = input.turns.filter((t) => t.role === 'user').map((t) => t.text).join('\n');
  try {
    const { data, usage } = await callModel({
      op: 'rep.grade',
      schema: repGradeEdgeSchema,
      system: repGradeEdgePrompt.system(input.locale),
      user: repGradeEdgePrompt.user({ ...input, criteria: input.criteria.map(({ id, text }) => ({ id, text })) }),
      locale: input.locale,
      maxTokens: 3000,
      temperature: 0.1,
      reasoning: 'minimal',
      actor: input.actor,
    });
    const harm = data.harm && quoteIn(userText, data.harm.quote) ? { quote: data.harm.quote.trim(), why: data.harm.why.trim(), criterionId: data.harm.criterionId } : undefined;
    return {
      criteria: verifyCriteria(input.criteria, data.criteria, userText),
      summary: data.summary.trim() || undefined,
      ...(harm ? { harm } : {}),
      keywordGrade: false,
      costUsd: usage.costUsd,
    };
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.info(`[reps] rep.grade (edge) unavailable: ${err.code}; keyword grading`);
    return { criteria: keywordCriteria(input.criteria, userText), keywordGrade: true, costUsd: 0 };
  }
}
