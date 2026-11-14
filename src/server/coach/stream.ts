import { AiError, getModelId, reasoningParam, type ReasoningEffort } from '@/server/ai/client';
import { consumeRateLimit, reserveBudget, type Actor, type Reservation } from '@/server/ai/budget';
import { costFromTokens, estimateMaxCostUsd } from '@/server/ai/pricing';

/**
 * Plain-text OpenRouter calls for the coach, next to `callModel` (which only does strict JSON):
 * a streaming chat completion and a one-shot text completion (used for transcription).
 *
 * Both reserve budget before each attempt and settle it to the billed `usage.cost`, count against the
 * caller's IP limit, retry a transient failure once with backoff and then fail over to the other model
 * (google/gemini-3.8-flash ↔ openai/gpt-6-luna, ROUND3 decision 2). A stream fails over only while
 * nothing has been sent to the person yet; an error after the first words ends the stream with
 * `AiError.partial` so the caller can keep what arrived and say the answer was cut off.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const FIRST_BYTE_MS = 25_000;
const IDLE_MS = 30_000;
const TOTAL_MS = 100_000;

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } };

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface TextCallInput {
  /** Operation id for logs, e.g. 'coach.chat'. */
  op: string;
  messages: ChatTurn[];
  maxTokens: number;
  temperature: number;
  /** Models in failover order; defaults to the product model and its partner. */
  models?: string[];
  reasoning?: ReasoningEffort;
  /** Per-IP limit only: the coach keeps its own per-profile daily cap. */
  actor?: Actor;
  signal?: AbortSignal;
  /** Budget reservation per attempt when the default estimate does not fit (audio input). */
  estimateUsd?: (model: string) => number;
}

export interface TextUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  attempts: number;
}

/** The product model first, then the other of the two (OPENROUTER_FALLBACK_MODEL overrides the partner). */
export function chatModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = getModelId();
  const partner = env.OPENROUTER_FALLBACK_MODEL || (primary.startsWith('openai/gpt-6-luna') ? 'google/gemini-3.8-flash' : 'openai/gpt-6-luna');
  return partner === primary ? [primary] : [primary, partner];
}

/** Attempt plan: each model gets a retry after a short backoff unless it timed out (then move on at once). */
function plan(models: string[]): { model: string; backoffMs: number }[] {
  // AI_BACKOFF_MS=0 (tests) removes the waits, as it does for callModel
  const scale = /^0(,0)*$/.test(process.env.AI_BACKOFF_MS ?? '') ? 0 : 1;
  const out: { model: string; backoffMs: number }[] = [];
  models.forEach((model, i) => {
    out.push({ model, backoffMs: i === 0 ? 0 : 150 * scale });
    out.push({ model, backoffMs: 700 * (i + 1) * scale });
  });
  return out;
}

/** Reasoning models whose endpoints reject `temperature` (kept in step with src/server/ai/client.ts). */
const NO_TEMPERATURE = [/^openai\/gpt-6/, /^openai\/o\d/];

function body(input: TextCallInput, model: string, stream: boolean) {
  return JSON.stringify({
    model,
    messages: input.messages,
    max_tokens: input.maxTokens,
    ...(NO_TEMPERATURE.some((re) => re.test(model)) ? {} : { temperature: input.temperature }),
    reasoning: reasoningParam(input.reasoning ?? 'off', model),
    usage: { include: true },
    stream,
  });
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    'X-Title': 'Irreplaceable',
  };
}

function promptChars(messages: ChatTurn[]): number {
  return messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : m.content.reduce((k, p) => k + (p.type === 'text' ? p.text.length : 0), 0)), 0);
}

const usd = (n: number) => `$${n.toFixed(5)}`;
function log(fields: Record<string, string | number | boolean | undefined>) {
  console.info(
    `[ai] ${Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`,
  );
}

/** A failure the next attempt may fix (network, timeout, 408/429/5xx), or one that ends the call. */
class AttemptError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly kind: 'timeout' | 'http' | 'network' | 'stream' | 'empty',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function httpFailure(status: number, message: string, op: string): AttemptError | AiError {
  if (status === 402) return new AiError('budget_exceeded', `OpenRouter credits exhausted: ${message}`, { op, providerStatus: status });
  const retryable = status === 408 || status === 429 || status >= 500 || status === 404;
  return new AttemptError(retryable, 'http', `provider error ${status}: ${message}`, status);
}

async function reserve(input: TextCallInput, model: string): Promise<Reservation> {
  const estimate = input.estimateUsd ? input.estimateUsd(model) : estimateMaxCostUsd({ model, promptChars: promptChars(input.messages), images: 0, maxTokens: input.maxTokens });
  const reserved = await reserveBudget(estimate);
  if (!reserved.ok) throw new AiError(reserved.denial.code, reserved.denial.reason, { op: input.op });
  return reserved.reservation;
}

async function prepare(input: TextCallInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new AiError('provider_error', 'OPENROUTER_API_KEY is not set', { op: input.op });
  const denied = await consumeRateLimit(input.actor);
  if (denied) throw new AiError(denied.code, denied.reason, { op: input.op });
  return apiKey;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (!ms) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

interface StreamChunk {
  id?: string;
  error?: { code?: number | string; message?: string };
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null; error?: { message?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/**
 * Streams the answer as text pieces; the generator's return value is the usage. When `input.signal` aborts
 * (the person pressed Stop or left), the generator simply ends early without an error.
 */
export async function* streamText(input: TextCallInput): AsyncGenerator<string, TextUsage, void> {
  const { op } = input;
  const apiKey = await prepare(input);
  const models = input.models?.length ? input.models : chatModels();
  const started = Date.now();
  let emitted = false;
  let lastError: Error | null = null;
  let skipModel: string | null = null;
  let attempts = 0;

  for (const step of plan(models)) {
    if (input.signal?.aborted) break;
    if (step.model === skipModel) continue;
    if (Date.now() - started > TOTAL_MS) break;
    await sleep(attempts ? step.backoffMs : 0, input.signal);
    attempts++;
    const model: string = step.model;
    const reservation = await reserve(input, model);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    input.signal?.addEventListener('abort', onAbort);
    let timer = setTimeout(() => ctrl.abort(new DOMException('first byte', 'TimeoutError')), FIRST_BYTE_MS);
    const usage = { promptTokens: 0, completionTokens: 0, cost: null as number | null };
    let settled = false;
    const settle = async (amount: number | 'release') => {
      if (settled) return;
      settled = true;
      if (amount === 'release') await reservation.release();
      else await reservation.settle(amount);
    };

    try {
      let res: Response;
      try {
        res = await fetch(ENDPOINT, { method: 'POST', signal: ctrl.signal, headers: headers(apiKey), body: body(input, model, true) });
      } catch (err) {
        if (input.signal?.aborted) throw err;
        const timedOut = ctrl.signal.aborted;
        throw new AttemptError(true, timedOut ? 'timeout' : 'network', `${timedOut ? 'no first byte' : 'network error'}: ${(err as Error).message}`);
      }
      if (!res.ok || !res.body) {
        let message = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as StreamChunk;
          message = j.error?.message ?? message;
        } catch {
          /* not JSON */
        }
        await settle('release');
        throw httpFailure(res.status, message, op);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read().catch((err: Error) => {
          if (input.signal?.aborted) return { value: undefined, done: true as const };
          throw new AttemptError(!emitted, ctrl.signal.aborted ? 'timeout' : 'stream', `stream broke: ${err.message}`);
        });
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(new DOMException('idle', 'TimeoutError')), IDLE_MS);
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue; // SSE comments such as ": OPENROUTER PROCESSING"
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            finished = true;
            break;
          }
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            continue;
          }
          if (chunk.error || chunk.choices?.[0]?.error) {
            const msg = chunk.error?.message ?? chunk.choices?.[0]?.error?.message ?? 'stream error';
            throw new AttemptError(!emitted, 'stream', `provider stream error: ${msg}`, Number(chunk.error?.code) || undefined);
          }
          if (chunk.usage) {
            usage.promptTokens = chunk.usage.prompt_tokens ?? usage.promptTokens;
            usage.completionTokens = chunk.usage.completion_tokens ?? usage.completionTokens;
            if (typeof chunk.usage.cost === 'number') usage.cost = chunk.usage.cost;
          }
          const piece = chunk.choices?.[0]?.delta?.content;
          if (piece) {
            emitted = true;
            yield piece;
          }
        }
      }
      reader.cancel().catch(() => undefined);
      if (input.signal?.aborted) {
        await settle(usage.cost ?? reservation.amountUsd);
        log({ op, model, stopped: true, ms: Date.now() - started });
        return { model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costUsd: usage.cost ?? reservation.amountUsd, attempts };
      }
      if (!emitted) throw new AttemptError(true, 'empty', 'empty answer');
      const cost = usage.cost ?? costFromTokens(model, usage.promptTokens, usage.completionTokens);
      await settle(cost);
      log({ op, model, attempt: attempts, cost: usd(cost), tokens: `${usage.promptTokens}/${usage.completionTokens}`, ms: Date.now() - started });
      return { model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costUsd: cost, attempts };
    } catch (err) {
      // A request that reached the provider may have been billed: keep the reservation (it only over-counts).
      await settle(reservation.amountUsd).catch(() => undefined);
      if (input.signal?.aborted) {
        return { model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costUsd: reservation.amountUsd, attempts };
      }
      if (err instanceof AiError) throw err;
      const e = err instanceof AttemptError ? err : new AttemptError(!emitted, 'network', (err as Error).message);
      log({ op, model, attempt: attempts, error: `${e.kind}${e.status ? `_${e.status}` : ''}`, ms: Date.now() - started });
      if (emitted) {
        const partial = new AiError('provider_error', `the answer broke off: ${e.message}`, { op });
        Object.assign(partial, { partial: true });
        throw partial;
      }
      lastError = e;
      if (!e.retryable) break;
      if (e.kind === 'timeout') skipModel = model; // a model that did not answer at all gets no second wait
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  if (input.signal?.aborted) return { model: models[0], promptTokens: 0, completionTokens: 0, costUsd: 0, attempts };
  const timeout = lastError instanceof AttemptError && lastError.kind === 'timeout';
  throw new AiError(timeout ? 'timeout' : 'provider_error', `no model answered: ${lastError?.message ?? 'unknown'}`, { op });
}

export const isPartialAiError = (err: unknown): boolean => err instanceof Error && (err as { partial?: boolean }).partial === true;

interface CompletionBody {
  error?: { code?: number | string; message?: string };
  choices?: { finish_reason?: string | null; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** One-shot text completion with the same retry, failover and budget rules. */
export async function completeText(input: TextCallInput): Promise<{ text: string; usage: TextUsage }> {
  const { op } = input;
  const apiKey = await prepare(input);
  const models = input.models?.length ? input.models : chatModels();
  const started = Date.now();
  let lastError: Error | null = null;
  let attempts = 0;
  let skipModel: string | null = null;

  for (const step of plan(models)) {
    if (input.signal?.aborted) break;
    if (step.model === skipModel) continue;
    await sleep(attempts ? step.backoffMs : 0, input.signal);
    attempts++;
    const model: string = step.model;
    const reservation = await reserve(input, model);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(FIRST_BYTE_MS + 20_000)]) : AbortSignal.timeout(FIRST_BYTE_MS + 20_000);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: 'POST', signal, headers: headers(apiKey), body: body(input, model, false) });
    } catch (err) {
      await reservation.settle(reservation.amountUsd);
      if (input.signal?.aborted) throw err;
      const timedOut = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      lastError = new AttemptError(true, timedOut ? 'timeout' : 'network', (err as Error).message);
      log({ op, model, attempt: attempts, error: timedOut ? 'timeout' : 'network', ms: Date.now() - started });
      if (timedOut) skipModel = model;
      continue;
    }
    let json: CompletionBody | null = null;
    try {
      json = (await res.json()) as CompletionBody;
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.error) {
      await reservation.release();
      const status = res.ok ? Number(json?.error?.code) || 502 : res.status;
      const failure = httpFailure(status, json?.error?.message ?? `HTTP ${res.status}`, op);
      log({ op, model, attempt: attempts, error: `http_${status}`, ms: Date.now() - started });
      if (failure instanceof AiError) throw failure;
      lastError = failure;
      if (!failure.retryable) break;
      continue;
    }
    const promptTokens = json.usage?.prompt_tokens ?? 0;
    const completionTokens = json.usage?.completion_tokens ?? 0;
    const cost = typeof json.usage?.cost === 'number' ? json.usage.cost : costFromTokens(model, promptTokens, completionTokens);
    await reservation.settle(cost);
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      lastError = new AttemptError(true, 'empty', 'empty answer');
      log({ op, model, attempt: attempts, error: 'empty', cost: usd(cost) });
      continue;
    }
    log({ op, model, attempt: attempts, cost: usd(cost), tokens: `${promptTokens}/${completionTokens}`, ms: Date.now() - started });
    return { text, usage: { model, promptTokens, completionTokens, costUsd: cost, attempts } };
  }
  throw new AiError(lastError instanceof AttemptError && lastError.kind === 'timeout' ? 'timeout' : 'provider_error', `no model answered: ${lastError?.message ?? 'unknown'}`, { op });
}
