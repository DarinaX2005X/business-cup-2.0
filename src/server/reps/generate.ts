import {
  keywordCriteria,
  keywordSpots,
  normalizeDocument,
  slipErrorCount,
  validateSlip,
  verifyCriteria,
  wordCount,
  hash32,
  type CriterionGrade,
  type RubricItem,
} from '@/domain/reps';
import type { Locale, Trap } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { AiError, callModel, isAiError } from '@/server/ai/client';
import { repDelegatePrompt, repDelegateRunPrompt, repDelegateRunSchema, repDelegateSchema, type RepDelegateOutput } from '@/server/ai/prompts/rep-delegate';
import { repEdgePrompt, repEdgeReplyPrompt, repEdgeReplySchema, repEdgeSchema, type RepEdgeOutput, type RepEdgeReply } from '@/server/ai/prompts/rep-edge';
import { repGradeDelegatePrompt, repGradeEdgePrompt, repGradeSchema } from '@/server/ai/prompts/rep-grade';
import { repSlipPrompt, repSlipSchema, type RepSlipOutput } from '@/server/ai/prompts/rep-slip';
import type { BankDelegate, BankEdge, BankEntry, BankSlip } from './bank';
import { plannedTypes } from './error-types';

/**
 * Generation, validation and grading with the model. Each generator returns a validated BankEntry —
 * the same object the bank script (03.3) saves to data/rep-bank and the live path turns into a rep —
 * or throws AiError ('invalid_output' when every attempt failed the checks).
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
  /** Model calls answered (1 = passed on the first attempt). */
  attempts: number;
  costUsd: number;
  /** Problems of the rejected attempts, for the bank report. */
  rejected: string[][];
}

/** Attempts after the first one when the validator rejects the output. */
export const SLIP_RETRIES = 2;
const STRUCT_RETRIES = 1;

// ---------------------------------------------------------------------------------------------
// Spot the slip

export async function generateSlip(input: GenerateInput): Promise<Generated<BankSlip>> {
  const n = slipErrorCount(input.difficulty);
  const types = plannedTypes(input.occupationCode, n, hash32(input.seed) % 3);
  let retry: { previous: RepSlipOutput; problems: string[] } | null = null;
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 1 + SLIP_RETRIES; attempt++) {
    const { data, usage } = await callModel({
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
    if (checked.ok) {
      const c = checked.content;
      return {
        entry: {
          type: 'slip',
          occupationCode: input.occupationCode,
          taskId: input.taskId,
          locale: input.locale,
          difficulty: input.difficulty,
          title: c.title,
          brief: c.brief,
          docType: c.docType,
          slip: c.slip,
        },
        attempts: attempt,
        costUsd: cost,
        rejected,
      };
    }
    rejected.push(checked.problems);
    console.info(`[reps] rep.slip attempt ${attempt} rejected: ${checked.problems.slice(0, 3).join(' | ').slice(0, 300)}`);
    retry = { previous: data, problems: checked.problems };
  }
  throw new AiError('invalid_output', `rep.slip failed validation ${1 + SLIP_RETRIES} times`, { op: 'rep.slip' });
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

export type DelegateValidation = { ok: true; content: Omit<BankDelegate, 'type' | 'occupationCode' | 'taskId' | 'locale' | 'difficulty'> } | { ok: false; problems: string[] };

/** Pure check of a generated Delegate scenario; normalises the inputs and keeps only verifiable trap keywords. */
export function validateDelegate(out: RepDelegateOutput): DelegateValidation {
  const problems: string[] = [];
  const inputs = normalizeDocument(out.inputs ?? '');
  const words = wordCount(inputs);
  if (words < 60 || words > 260) problems.push(`inputs has ${words} words; it must have 80–200.`);
  for (const f of ['title', 'brief', 'scenario', 'goal'] as const) if (!out[f]?.trim()) problems.push(`${f} is empty.`);
  const criteria = rubric(out.criteria ?? [], 6);
  if (criteria.length < 4) problems.push(`There must be 4–6 criteria; you gave ${criteria.length}.`);
  const traps: Trap[] = [];
  (out.traps ?? []).slice(0, 2).forEach((t, i) => {
    const keywords = trapKeywords(t.keywords ?? [], inputs);
    if (!t.description?.trim()) problems.push(`Trap ${i + 1}: description is empty.`);
    if (!keywords.length) {
      problems.push(`Trap ${i + 1}: none of its keywords (${(t.keywords ?? []).join(', ')}) appears in the inputs verbatim and at most 3 times; copy the exact conflicting value or item from the inputs.`);
      return;
    }
    traps.push({ id: `t${i + 1}`, description: t.description.trim(), keywords });
  });
  if ((out.traps ?? []).length < 2) problems.push('There must be exactly 2 traps.');
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    content: { title: out.title.trim(), brief: out.brief.trim(), delegate: { scenario: out.scenario.trim(), inputs, goal: out.goal.trim(), criteria, traps } },
  };
}

export async function generateDelegate(input: GenerateInput): Promise<Generated<BankDelegate>> {
  let retry: { previous: RepDelegateOutput; problems: string[] } | null = null;
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 1 + STRUCT_RETRIES; attempt++) {
    const { data, usage } = await callModel({
      op: 'rep.delegate',
      schema: repDelegateSchema,
      system: repDelegatePrompt.system(input.locale),
      user: repDelegatePrompt.user({ occupation: input.occupation, task: input.task, locale: input.locale, seed: input.seed, retry }),
      locale: input.locale,
      maxTokens: 4000,
      temperature: 0.8,
      reasoning: 'minimal',
      actor: attempt === 1 ? input.actor : undefined,
      signal: input.signal,
    });
    cost += usage.costUsd;
    const checked = validateDelegate(data);
    if (checked.ok) {
      return {
        entry: { type: 'delegate', occupationCode: input.occupationCode, taskId: input.taskId, locale: input.locale, difficulty: input.difficulty, ...checked.content },
        attempts: attempt,
        costUsd: cost,
        rejected,
      };
    }
    rejected.push(checked.problems);
    retry = { previous: data, problems: checked.problems };
  }
  throw new AiError('invalid_output', 'rep.delegate failed validation', { op: 'rep.delegate' });
}

/** The AI following the person's instruction literally (temperature 0.3). */
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
  const output = normalizeDocument(data.output);
  if (!output) throw new AiError('invalid_output', 'rep.delegate.run returned an empty result', { op: 'rep.delegate.run' });
  return { output, costUsd: usage.costUsd };
}

export interface RubricGrade {
  criteria: CriterionGrade[];
  summary?: string;
  fixFeedback?: string;
  /** true when the model was unavailable and keywords decided. */
  keywordGrade: boolean;
  costUsd: number;
}

/** rep.grade for Delegate; quotes are checked against the instruction. Falls back to keyword grading. */
export async function gradeDelegate(input: {
  occupation: string;
  locale: Locale;
  scenario: string;
  goal: string;
  inputs: string;
  criteria: RubricItem[];
  instruction: string;
  run: string;
  highlighted: string[];
  fix: string;
  actor?: Actor;
}): Promise<RubricGrade> {
  try {
    const { data, usage } = await callModel({
      op: 'rep.grade',
      schema: repGradeSchema,
      system: repGradeDelegatePrompt.system(input.locale),
      user: repGradeDelegatePrompt.user({ ...input, criteria: input.criteria.map(({ id, text }) => ({ id, text })) }),
      locale: input.locale,
      maxTokens: 3000,
      temperature: 0.1,
      reasoning: 'minimal',
      actor: input.actor,
    });
    return {
      criteria: verifyCriteria(input.criteria, data.criteria, input.instruction),
      summary: data.summary.trim() || undefined,
      fixFeedback: data.fixFeedback?.trim() || undefined,
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
  for (let attempt = 1; attempt <= 1 + STRUCT_RETRIES; attempt++) {
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

/** rep.grade for Human edge; quotes are checked against the person's replies. Falls back to keyword grading. */
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
      schema: repGradeSchema,
      system: repGradeEdgePrompt.system(input.locale),
      user: repGradeEdgePrompt.user({ ...input, criteria: input.criteria.map(({ id, text }) => ({ id, text })) }),
      locale: input.locale,
      maxTokens: 3000,
      temperature: 0.1,
      reasoning: 'minimal',
      actor: input.actor,
    });
    return { criteria: verifyCriteria(input.criteria, data.criteria, userText), summary: data.summary.trim() || undefined, keywordGrade: false, costUsd: usage.costUsd };
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.info(`[reps] rep.grade (edge) unavailable: ${err.code}; keyword grading`);
    return { criteria: keywordCriteria(input.criteria, userText), keywordGrade: true, costUsd: 0 };
  }
}
