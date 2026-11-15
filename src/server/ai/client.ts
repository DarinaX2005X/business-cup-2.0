import { z } from 'zod';
import { requestDeadline } from './deadline';
import { consumeRateLimit, reserveBudget, type Actor, type BudgetStatus, type Reservation } from './budget';
import { cacheGet, cacheSet, cacheStoreKey, DEFAULT_CACHE_TTL_SEC } from './cache';
import { costFromTokens, estimateMaxCostUsd } from './pricing';
import type { Locale } from '@/domain/types';

/**
 * The only door to the model: OpenRouter Chat Completions with a strict JSON schema derived from zod,
 * budget reservation, per-profile/IP limits, an optional result cache, one bounded retry and zod
 * validation of the answer. Callers get typed data or an AiError, never a canned success.
 */

export type AiErrorCode = 'budget_exceeded' | 'rate_limited' | 'timeout' | 'invalid_output' | 'provider_error';
export type ReasoningEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high';

const HTTP_STATUS: Record<AiErrorCode, number> = {
  budget_exceeded: 503,
  rate_limited: 429,
  timeout: 504,
  invalid_output: 502,
  provider_error: 502,
};

/**
 * `message` is for logs and developers: no user text, no secrets. Routes map `code` to their own
 * response (usually 503 `ai_unavailable` with a degraded result, 429 for `rate_limited`).
 */
export class AiError extends Error {
  readonly status: number;
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly detail: { op?: string; providerStatus?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.status = HTTP_STATUS[code];
  }
}

export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError || (err instanceof Error && err.name === 'AiError' && 'code' in err);
}

// ---------------------------------------------------------------------------------------------
// Strict schema

export class StrictSchemaError extends Error {
  constructor(path: string, problem: string) {
    super(`Schema is not strict-compatible at ${path || '(root)'}: ${problem}`);
    this.name = 'StrictSchemaError';
  }
}

type JsonSchema = Record<string, unknown>;

const FORBIDDEN = ['oneOf', 'allOf', 'not', '$ref', 'if', 'then', 'else', 'patternProperties', 'prefixItems', 'dependentSchemas'];
const SAFE_INT = 9007199254740991;

function convertNode(node: JsonSchema, path: string): JsonSchema {
  for (const key of FORBIDDEN) {
    if (key in node) throw new StrictSchemaError(path, `"${key}" is not allowed (use plain objects, arrays and enums)`);
  }

  if (Array.isArray(node.anyOf)) {
    const options = node.anyOf as JsonSchema[];
    const nonNull = options.filter((o) => o.type !== 'null');
    if (nonNull.length !== 1 || options.length !== 2) {
      throw new StrictSchemaError(path, 'unions are not allowed; only `.nullable()` of a single type');
    }
    return makeNullable(convertNode(nonNull[0], path), path);
  }

  const out: JsonSchema = {};
  const type = node.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== 'null');
    if (nonNull.length !== 1 || type.length !== 2) {
      throw new StrictSchemaError(path, `unions are not allowed (${JSON.stringify(type)}); only \`.nullable()\` of a single type`);
    }
    return makeNullable(convertNode({ ...node, type: nonNull[0] }, path), path);
  }
  if (typeof type !== 'string') throw new StrictSchemaError(path, 'every node needs a concrete "type" (no z.any/z.unknown)');
  out.type = type;
  if (typeof node.description === 'string') out.description = node.description;

  if ('const' in node) out.enum = [node.const];
  if (Array.isArray(node.enum)) out.enum = node.enum;

  if (type === 'object') {
    const props = node.properties as Record<string, JsonSchema> | undefined;
    if (!props || Object.keys(props).length === 0) {
      throw new StrictSchemaError(path, 'objects need fixed properties (no z.record / dynamic keys; use an array of { key, value })');
    }
    if (node.additionalProperties !== false) throw new StrictSchemaError(path, 'additionalProperties must be false (use z.object, not looseObject)');
    const required = new Set((node.required as string[] | undefined) ?? []);
    const missing = Object.keys(props).filter((k) => !required.has(k));
    if (missing.length) {
      throw new StrictSchemaError(path, `optional fields are not allowed (${missing.join(', ')}); use .nullable() and return null`);
    }
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, convertNode(v, `${path}.${k}`)]));
    out.required = Object.keys(props);
    out.additionalProperties = false;
  } else if (type === 'array') {
    if (!node.items || Array.isArray(node.items) || typeof node.items !== 'object') {
      throw new StrictSchemaError(path, 'arrays need a single item schema (no tuples)');
    }
    out.items = convertNode(node.items as JsonSchema, `${path}[]`);
    if (typeof node.minItems === 'number') out.minItems = node.minItems;
    if (typeof node.maxItems === 'number') out.maxItems = node.maxItems;
  } else if (type === 'number' || type === 'integer') {
    if (typeof node.minimum === 'number' && Math.abs(node.minimum) < SAFE_INT) out.minimum = node.minimum;
    if (typeof node.maximum === 'number' && Math.abs(node.maximum) < SAFE_INT) out.maximum = node.maximum;
  }
  // string length, pattern and format constraints are left to zod: providers differ in support.
  return out;
}

function makeNullable(inner: JsonSchema, path: string): JsonSchema {
  if (typeof inner.type !== 'string') throw new StrictSchemaError(path, 'nested nullable');
  const out: JsonSchema = { ...inner, type: [inner.type, 'null'] };
  if (Array.isArray(inner.enum)) out.enum = [...inner.enum, null];
  return out;
}

const schemaCache = new WeakMap<z.ZodType, JsonSchema>();

/**
 * zod → JSON Schema accepted by strict structured outputs (OpenRouter → Gemini, also OpenAI):
 * every object closed and fully required, no unions except `.nullable()` of one type,
 * no records/any. Throws StrictSchemaError naming the offending path.
 * Uses zod 4's own `z.toJSONSchema` (zod-to-json-schema 3.x returns an empty schema for zod 4).
 */
export function strictSchema(schema: z.ZodType): JsonSchema {
  const hit = schemaCache.get(schema);
  if (hit) return hit;
  let raw: JsonSchema;
  try {
    raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'output', unrepresentable: 'throw' }) as JsonSchema;
  } catch (err) {
    throw new StrictSchemaError('', `cannot be represented as JSON Schema (${(err as Error).message})`);
  }
  if (raw.type !== 'object') throw new StrictSchemaError('', 'the root must be an object');
  const converted = convertNode(raw, '');
  schemaCache.set(schema, converted);
  return converted;
}

// ---------------------------------------------------------------------------------------------
// callModel

export interface CallModelInput<S extends z.ZodType> {
  /** Operation id, e.g. 'resume.parse'. Used for the cache key, logs and the schema name. */
  op: string;
  schema: S;
  system: string;
  user: string;
  /** data: URLs or https URLs. */
  images?: string[];
  locale: Locale;
  /** Set only for deterministic operations; identical input then costs nothing the second time. */
  cacheKey?: string;
  cacheTtlSec?: number;
  maxTokens: number;
  temperature: number;
  /** Who triggered the call, for the 25/day profile and 60/day IP limits. Scripts omit it. */
  actor?: Actor;
  /** Overrides AI_REASONING_EFFORT for this call. */
  reasoning?: ReasoningEffort;
  /** Start on the other model (a generator's last attempt after the first model's output failed its checks). */
  preferFailover?: boolean;
  signal?: AbortSignal;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface CallModelResult<T> {
  data: T;
  usage: ModelUsage;
  cached: boolean;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'google/gemini-3.8-flash';
const TIMEOUT_MS = 45_000;

export function getModelId(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

/** Long document generation (the rep writers) can run on a cheaper model set in OPENROUTER_MODEL_GEN. */
const GENERATION_OPS = new Set(['rep.slip', 'rep.delegate', 'rep.edge', 'rep.verify', 'plan.generate', 'profile.skills']);

/**
 * The other model to fail over to when the first one keeps failing (transport errors, timeouts, 5xx,
 * 429, invalid JSON): google/gemini-3.8-flash ↔ openai/gpt-6-luna. OPENROUTER_MODEL_FAILOVER overrides.
 */
export function failoverModel(model: string): string {
  const env = process.env.OPENROUTER_MODEL_FAILOVER;
  if (env && env !== model) return env;
  return /^google\//.test(model) ? 'openai/gpt-6-luna' : 'google/gemini-3.8-flash';
}

/** Attempts per model (with backoff between them) before failing over, and the whole call's time limit. */
const ATTEMPTS_PER_MODEL = 2;
/** AI_BACKOFF_MS (comma list) overrides the waits, e.g. "0,0" in tests. */
const backoffMs = (attempt: number) => Number((process.env.AI_BACKOFF_MS ?? '700,2000').split(',')[attempt - 1] ?? 2_000) || 0;
const CALL_DEADLINE_MS = 100_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export function modelFor(op: string): string {
  const gen = process.env.OPENROUTER_MODEL_GEN;
  return gen && GENERATION_OPS.has(op) ? gen : getModelId();
}

/**
 * Models whose endpoint refuses to switch reasoning off (OpenRouter answers 400 "Reasoning is mandatory
 * for this endpoint and cannot be disabled", seen for google/gemini-3.8-flash). For them 'off' is sent
 * as the cheapest allowed level, so no caller can trigger that 400.
 */
const REASONING_MANDATORY = [/^google\/gemini-3/];

/**
 * Reasoning models whose endpoints reject `temperature` (with `require_parameters` OpenRouter then finds
 * no endpoint and answers 404). For them the parameter is left out and the model's default is used.
 */
const NO_TEMPERATURE = [/^openai\/gpt-6/, /^openai\/o\d/];

export function reasoningParam(effort: ReasoningEffort, model: string) {
  if (effort === 'off') {
    return REASONING_MANDATORY.some((re) => re.test(model)) ? { effort: 'minimal' as const, exclude: true } : { enabled: false, exclude: true };
  }
  return { effort, exclude: true };
}

function defaultReasoning(): ReasoningEffort {
  const v = process.env.AI_REASONING_EFFORT as ReasoningEffort | undefined;
  return v && ['off', 'minimal', 'low', 'medium', 'high'].includes(v) ? v : 'minimal';
}

interface ORMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
}

interface ORResponse {
  id?: string;
  error?: { code?: number | string; message?: string };
  choices?: { finish_reason?: string | null; native_finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null }; error?: { message?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1] : t;
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function log(fields: Record<string, string | number | boolean | undefined>) {
  const line = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.info(`[ai] ${line}`);
}

const usd = (n: number) => `$${n.toFixed(5)}`;

export async function callModel<S extends z.ZodType>(input: CallModelInput<S>): Promise<CallModelResult<z.infer<S>>> {
  const { op } = input;
  const primary = input.preferFailover ? failoverModel(modelFor(op)) : modelFor(op);
  const started = Date.now();
  const jsonSchema = strictSchema(input.schema);

  const cacheKey =
    input.cacheKey !== undefined
      ? cacheStoreKey(op, { k: input.cacheKey, model: primary, system: input.system, user: input.user, images: input.images ?? [], schema: jsonSchema })
      : null;
  if (cacheKey) {
    const hit = await cacheGet(cacheKey, input.schema);
    if (hit !== null) {
      log({ op, cached: true, cost: usd(0), ms: Date.now() - started });
      return { data: hit, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 }, cached: true };
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new AiError('provider_error', 'OPENROUTER_API_KEY is not set', { op });

  const denied = await consumeRateLimit(input.actor);
  if (denied) {
    log({ op, refused: denied.code });
    throw new AiError(denied.code, denied.reason, { op });
  }

  const userContent: ORMessage['content'] = input.images?.length
    ? [{ type: 'text', text: input.user }, ...input.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))]
    : input.user;
  const usage: ModelUsage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 };
  const effort = input.reasoning ?? defaultReasoning();
  let lastStatus: BudgetStatus | null = null;
  let lastRequestId: string | undefined;
  let lastError: AiError | null = null;
  // the call's own limit, cut short by the request's deadline (the route's maxDuration, see deadline.ts)
  const deadline = Math.min(started + CALL_DEADLINE_MS, requestDeadline() ?? Infinity);
  const models = [primary, failoverModel(primary)].filter((m, i, all) => all.indexOf(m) === i);

  for (const [mi, model] of models.entries()) {
    if (mi > 0) log({ op, failover: `${models[mi - 1]}->${model}`, after: lastError?.code });
    // a fresh conversation per model: repair messages written for one model do not carry over
    const messages: ORMessage[] = [
      { role: 'system', content: input.system },
      { role: 'user', content: userContent },
    ];
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) break;
      if (attempt > 0) await sleep(Math.min(backoffMs(attempt), remaining - 4_000));
      const promptChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : input.user.length), 0);
      const estimate = estimateMaxCostUsd({ model, promptChars, images: input.images?.length ?? 0, maxTokens: input.maxTokens });
      const reserved = await reserveBudget(estimate, input.actor);
      if (!reserved.ok) {
        log({ op, refused: reserved.denial.code });
        throw new AiError(reserved.denial.code, reserved.denial.reason, { op });
      }
      const reservation: Reservation = reserved.reservation;

      const timeoutMs = Math.min(TIMEOUT_MS, deadline - Date.now());
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
            'X-Title': 'Irreplaceable',
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: input.maxTokens,
            ...(NO_TEMPERATURE.some((re) => re.test(model)) ? {} : { temperature: input.temperature }),
            response_format: { type: 'json_schema', json_schema: { name: op.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), strict: true, schema: jsonSchema } },
            reasoning: reasoningParam(effort, model),
            usage: { include: true },
            provider: { require_parameters: true },
          }),
        });
      } catch (err) {
        // The request may have reached the provider, so the reservation is kept (it can only over-count).
        await reservation.settle(reservation.amountUsd);
        if (input.signal?.aborted) throw err;
        const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
        log({ op, model, error: isTimeout ? 'timeout' : 'network', attempt: attempt + 1, ms: Date.now() - started });
        lastError = isTimeout
          ? new AiError('timeout', `no answer within ${Math.round(timeoutMs / 1000)}s`, { op })
          : new AiError('provider_error', `network error: ${(err as Error).message}`, { op });
        continue;
      }

      let body: ORResponse | null = null;
      try {
        body = (await res.json()) as ORResponse;
      } catch {
        body = null;
      }
      lastRequestId = body?.id;

      if (!res.ok || !body || body.error) {
        // OpenRouter does not bill requests that fail before generation.
        await reservation.release();
        const status = res.ok ? Number(body?.error?.code) || 502 : res.status;
        const message = body?.error?.message ?? `HTTP ${res.status}`;
        const detail = { op, providerStatus: status, requestId: lastRequestId };
        log({ op, model, error: `http_${status}`, attempt: attempt + 1, ms: Date.now() - started });
        // the key's credit is shared by every model: switching does not help
        if (status === 402) throw new AiError('budget_exceeded', `OpenRouter credits exhausted: ${message}`, detail);
        if (status === 429) lastError = new AiError('rate_limited', `provider rate limit: ${message}`, detail);
        else if (status === 408) lastError = new AiError('timeout', `provider timeout: ${message}`, detail);
        else lastError = new AiError('provider_error', `provider error ${status}: ${message}`, detail);
        if (status === 429 || status === 408 || status >= 500) continue; // transient: retry this model
        break; // 400/404…: this model cannot take the request; try the other one
      }

      const promptTokens = body.usage?.prompt_tokens ?? 0;
      const completionTokens = body.usage?.completion_tokens ?? 0;
      const cost = typeof body.usage?.cost === 'number' ? body.usage.cost : costFromTokens(model, promptTokens, completionTokens);
      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
      usage.reasoningTokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      usage.costUsd += cost;
      lastStatus = await reservation.settle(cost);

      const choice = body.choices?.[0];
      const content = choice?.message?.content;
      let problem: string;
      if (choice?.finish_reason === 'length') {
        problem = `the answer was cut off at max_tokens=${input.maxTokens}`;
      } else if (typeof content !== 'string' || !content.trim()) {
        problem = choice?.message?.refusal ? 'the model refused' : 'empty answer';
      } else {
        let json: unknown;
        try {
          json = JSON.parse(stripFences(content));
        } catch {
          json = undefined;
        }
        if (json === undefined) {
          problem = 'the answer is not valid JSON';
        } else {
          const parsed = input.schema.safeParse(json);
          if (parsed.success) {
            if (cacheKey) await cacheSet(cacheKey, parsed.data, input.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC);
            log({
              op,
              cached: false,
              ...(model !== primary ? { model } : {}),
              attempt: attempt + 1,
              cost: usd(usage.costUsd),
              day: lastStatus ? `${usd(lastStatus.dayUsd)}/${lastStatus.dayLimitUsd}` : undefined,
              total: lastStatus ? `${usd(lastStatus.totalUsd)}/${lastStatus.totalLimitUsd}` : undefined,
              tokens: `${usage.promptTokens}/${usage.completionTokens}`,
              reasoning: usage.reasoningTokens,
              ms: Date.now() - started,
              id: lastRequestId,
            });
            return { data: parsed.data, usage, cached: false };
          }
          problem = `the JSON does not match the schema: ${summarizeIssues(parsed.error)}`;
        }
      }

      log({ op, model, attempt: attempt + 1, invalid: problem.slice(0, 120), cost: usd(usage.costUsd) });
      lastError = new AiError('invalid_output', `the model did not return valid output: ${problem.slice(0, 160)}`, { op, requestId: lastRequestId });
      if (typeof content === 'string' && content.trim()) messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your previous answer was rejected: ${problem}. Answer again with a single JSON object that follows the schema exactly${
          choice?.finish_reason === 'length' ? ', and keep every text field shorter' : ''
        }.`,
      });
    }
  }

  // Both models failed after their retries: an honest error with the last cause, never a canned answer.
  throw lastError ?? new AiError('timeout', 'no time left for another attempt', { op });
}
