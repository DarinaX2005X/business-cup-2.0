import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Profile } from '@/domain/types';
import { callModel, isAiError } from '@/server/ai/client';
import {
  COACH_MAX_TOKENS,
  COACH_TEMPERATURE,
  coachSystem,
  historyTurns,
  previewQuestion,
  previewUser,
  starterQuestions,
} from '@/server/ai/prompts/coach';
import { HttpError } from '@/server/profile/http';
import { hasCoach } from './access';
import { buildContext, loadExtras, snapshotOf, type CoachContext, type ContextExtras } from './context';
import { appendExchange, DAILY_CAP, lockAnswer, messagesLeft, PROMPT_TURNS, readHistory, takeMessageSlot } from './history';
import { isPartialAiError, streamText } from './stream';
import { isNoSpeech, transcribe } from './transcribe';
import type { CoachEvent, CoachMessage, CoachPreview, CoachState, CoachStreamError } from './types';

/**
 * The coach's operations: the screen state, the locked preview and one streamed answer.
 * Routes authenticate and validate; this module owns access, the cap, history and the model calls.
 */

export interface CoachRequestCtx {
  profile: Profile;
  ip: string | null;
  /**
   * Whose conversation and daily cap this is: the profile id, or on a shared demo account the profile id
   * plus a hash of this device's secret, so judges sharing one demo account each get their own chat.
   */
  owner?: string;
}

const ownerOf = (ctx: CoachRequestCtx) => ctx.owner ?? ctx.profile.id;

async function contextFor(ctx: CoachRequestCtx): Promise<CoachContext> {
  const extras: ContextExtras = await loadExtras(ctx.profile);
  return buildContext(ctx.profile, extras);
}

export async function coachState(ctx: CoachRequestCtx): Promise<CoachState> {
  const [context, history, left] = await Promise.all([contextFor(ctx), readHistory(ownerOf(ctx)), messagesLeft(ownerOf(ctx))]);
  const access = context.tier === 'coach' ? 'coach' : 'locked';
  return {
    access,
    tier: context.tier,
    hasMap: context.hasMap,
    me: snapshotOf(context),
    starters: starterQuestions(context),
    messages: access === 'coach' ? history.messages : [],
    left,
    cap: DAILY_CAP,
  };
}

const previewSchema = z.object({ answer: z.string().min(1).max(2400) });

/**
 * One real exchange on the person's own week for Free and Pro: the first starter question answered by
 * the model with the same brief and context as the coach, cached per context so a revisit costs nothing.
 */
export async function coachPreview(ctx: CoachRequestCtx): Promise<CoachPreview> {
  const context = await contextFor(ctx);
  if (!context.hasMap || !context.xrayId) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  const { q, basis } = previewQuestion(context);
  const { data } = await callModel({
    op: 'coach.preview',
    schema: previewSchema,
    system: coachSystem(context),
    user: previewUser(q),
    locale: 'en',
    // personal (their week and progress): kept one day, so a revisit is free but nothing lingers
    cacheKey: `${context.xrayId}:${context.score}`,
    cacheTtlSec: 24 * 3600,
    maxTokens: 700,
    temperature: 0.4,
    actor: { profileId: ctx.profile.id, ip: ctx.ip },
  });
  return { question: q, answer: data.answer.trim(), basis };
}

// ---------------------------------------------------------------------------------------------
// One answer

export interface AskInput {
  /** Client id of the person's message (dedupes a resend of the same message). */
  id: string;
  text?: string;
  voice?: { base64: string; seconds: number };
}

const enc = new TextEncoder();
const line = (e: CoachEvent) => enc.encode(`${JSON.stringify(e)}\n`);

function errorCodeOf(err: unknown): CoachStreamError {
  if (isAiError(err)) {
    if (err.code === 'budget_exceeded') return 'budget';
    if (err.code === 'rate_limited') return 'rate_limited';
  }
  return 'coach_failed';
}

/**
 * Checks access, the daily cap and the one-at-a-time lock, then returns an NDJSON stream of CoachEvent:
 * `accepted`, for voice a `transcript`, `delta` pieces of the answer and `done` with the saved message, or
 * `error`. The exchange is saved only when the answer completes (or the person stops it partway); a failed
 * answer saves nothing and gives the message slot back, and the client keeps the person's text to resend.
 */
export async function ask(ctx: CoachRequestCtx, input: AskInput, requestSignal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { profile } = ctx;
  const owner = ownerOf(ctx);
  if (!hasCoach(profile)) throw new HttpError(402, 'coach_required', 'The personal coach comes with Max.');
  if (!input.text?.trim() && !input.voice) throw new HttpError(400, 'invalid_input', 'Send a text or a voice message.');

  const history = await readHistory(owner);
  const seen = history.messages.findIndex((m) => m.id === input.id && m.role === 'user');
  if (seen >= 0 && history.messages[seen + 1]?.role === 'coach') {
    // The same message arrived twice (a resend after a lost connection): answer with what was saved.
    const saved = history.messages[seen + 1];
    const left = await messagesLeft(owner);
    return new ReadableStream({
      start(c) {
        c.enqueue(line({ t: 'accepted', id: input.id }));
        c.enqueue(line({ t: 'done', message: saved, left }));
        c.close();
      },
    });
  }

  const release = await lockAnswer(owner, randomBytes(6).toString('hex'));
  if (!release) throw new HttpError(409, 'coach_busy', 'The coach is still answering your previous message.');
  const slot = await takeMessageSlot(owner).catch(async (err) => {
    await release();
    throw err;
  });
  if (!slot.ok) {
    await release();
    throw new HttpError(429, 'coach_cap', `You've sent ${DAILY_CAP} messages today. The coach is back tomorrow.`);
  }

  const abort = new AbortController();
  const onRequestAbort = () => abort.abort();
  requestSignal?.addEventListener('abort', onRequestAbort);
  const actor = { ip: ctx.ip };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: CoachEvent) => {
        if (!open) return;
        try {
          controller.enqueue(line(e));
        } catch {
          open = false;
        }
      };
      const now = () => new Date().toISOString();
      let answered = false;
      let userMessage: CoachMessage | null = null;
      let answer = '';
      try {
        send({ t: 'accepted', id: input.id });
        const contextP = contextFor(ctx);
        contextP.catch(() => undefined);

        let text = input.text?.trim() ?? '';
        if (input.voice) {
          try {
            const heard = await transcribe({ wavBase64: input.voice.base64, seconds: input.voice.seconds, actor, signal: abort.signal });
            text = heard.text;
          } catch (err) {
            if (abort.signal.aborted) return;
            send({ t: 'error', code: isNoSpeech(err) ? 'no_speech' : isAiError(err) && err.code !== 'provider_error' && err.code !== 'timeout' ? errorCodeOf(err) : 'transcribe_failed' });
            return;
          }
          send({ t: 'transcript', id: input.id, text, seconds: Math.round(input.voice.seconds) });
        }
        userMessage = { id: input.id, role: 'user', text, at: now(), ...(input.voice ? { via: 'voice' as const, seconds: Math.round(input.voice.seconds) } : {}) };

        const context = await contextP;
        const prior = history.messages.slice(-PROMPT_TURNS);
        while (prior.length && prior[0].role !== 'user') prior.shift();
        const messages = [
          { role: 'system' as const, content: coachSystem(context) },
          ...historyTurns(prior),
          ...historyTurns([userMessage]),
        ];

        try {
          const gen = streamText({ op: 'coach.chat', messages, maxTokens: COACH_MAX_TOKENS, temperature: COACH_TEMPERATURE, actor, signal: abort.signal, reasoning: 'off' });
          for await (const piece of gen) {
            answer += piece;
            send({ t: 'delta', text: piece });
          }
        } catch (err) {
          if (!abort.signal.aborted) {
            console.warn(`[coach] answer failed (${isPartialAiError(err) ? 'after first words' : 'before output'}): ${(err as Error).message}`);
            send({ t: 'error', code: errorCodeOf(err), ...(input.voice ? { transcript: text } : {}) });
            return;
          }
        }

        const stopped = abort.signal.aborted;
        if (!answer.trim()) {
          if (!stopped) send({ t: 'error', code: 'coach_failed', ...(input.voice ? { transcript: text } : {}) });
          return;
        }
        const coachMessage: CoachMessage = { id: `c_${randomBytes(6).toString('hex')}`, role: 'coach', text: answer.trim(), at: now(), ...(stopped ? { stopped: true } : {}) };
        await appendExchange(owner, [userMessage, coachMessage]);
        answered = true;
        send({ t: 'done', message: coachMessage, left: slot.left });
      } catch (err) {
        console.error('[coach] stream failed', err);
        send({ t: 'error', code: 'coach_failed' });
      } finally {
        requestSignal?.removeEventListener('abort', onRequestAbort);
        if (!answered) await slot.release().catch(() => undefined);
        await release();
        if (open) {
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
}
