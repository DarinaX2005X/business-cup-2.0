import { z } from 'zod';
import { dayKey } from '@/server/ai/budget';
import { getStore, isConflictError } from '@/server/store';
import type { CoachMessage } from './types';

/**
 * The coach conversation of one profile: `coach:<profileId>`, a versioned record holding the last
 * HISTORY_MAX messages. A whole exchange (the person's message and the coach's answer) is written in one
 * versioned update, so a failed answer never leaves half an exchange behind. «New chat» empties it.
 *
 * The daily cap is a counter per profile and UTC day (`coach:cap:<id>:<day>`), separate from the
 * general model-call limit, so a long talk with the coach does not use up the person's reps.
 *
 * Every function takes the conversation owner: the profile id, or `<profileId>:d<hash>` for one device
 * of a shared demo account (see `coachCtx`). Both forms sit under the `coach:<profileId>` and
 * `coach:cap:<profileId>:` prefixes, so deleting the profile finds them all.
 */

export const HISTORY_MAX = 30;
export const DAILY_CAP = 200;
/** Messages sent to the model as conversation (the rest stays visible but out of the prompt). */
export const PROMPT_TURNS = 16;

export const coachKey = (profileId: string) => `coach:${profileId}`;
export const capKey = (profileId: string, day: string) => `coach:cap:${profileId}:${day}`;
export const busyKey = (profileId: string) => `coach:busy:${profileId}`;

const messageSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.enum(['user', 'coach']),
  text: z.string(),
  at: z.string(),
  via: z.literal('voice').optional(),
  seconds: z.number().optional(),
  stopped: z.boolean().optional(),
});

const recordSchema = z.object({ messages: z.array(messageSchema) });

export async function readHistory(profileId: string): Promise<{ messages: CoachMessage[]; version: number }> {
  const hit = await getStore().get<unknown>(coachKey(profileId));
  if (!hit) return { messages: [], version: 0 };
  const parsed = recordSchema.safeParse(hit.value);
  // A malformed record is treated as an empty conversation and replaced by the next write.
  return { messages: parsed.success ? parsed.data.messages : [], version: hit.version };
}

/** Keeps the newest messages, starting on a person's message so the window never opens mid-exchange. */
export function trimHistory(messages: CoachMessage[], max = HISTORY_MAX): CoachMessage[] {
  if (messages.length <= max) return messages;
  let out = messages.slice(-max);
  while (out.length && out[0].role !== 'user') out = out.slice(1);
  return out;
}

/** Appends one exchange; retries on a concurrent write from another tab. */
export async function appendExchange(profileId: string, exchange: CoachMessage[]): Promise<CoachMessage[]> {
  const store = getStore();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { messages, version } = await readHistory(profileId);
    const known = new Set(messages.map((m) => m.id));
    const next = trimHistory([...messages, ...exchange.filter((m) => !known.has(m.id))]);
    try {
      await store.set(coachKey(profileId), { messages: next }, { version });
      return next;
    } catch (err) {
      if (!isConflictError(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
  throw new Error('coach history: too many concurrent writes');
}

export async function clearHistory(profileId: string): Promise<void> {
  await getStore().del(coachKey(profileId));
}

// ---------------------------------------------------------------------------------------------
// Daily cap and the one-answer-at-a-time lock

export async function messagesLeft(profileId: string, now = new Date()): Promise<number> {
  const used = await getStore().getNumber(capKey(profileId, dayKey(now)));
  return Math.max(0, DAILY_CAP - used);
}

/** Takes one message slot; false when today's cap is reached. `release()` gives it back (nothing was answered). */
export async function takeMessageSlot(profileId: string, now = new Date()): Promise<{ ok: boolean; left: number; release: () => Promise<void> }> {
  const store = getStore();
  const key = capKey(profileId, dayKey(now));
  const used = await store.incrFloat(key, 1, 2 * 24 * 3600);
  if (used > DAILY_CAP) {
    await store.incrFloat(key, -1);
    return { ok: false, left: 0, release: async () => undefined };
  }
  let released = false;
  return {
    ok: true,
    left: Math.max(0, DAILY_CAP - used),
    release: async () => {
      if (released) return;
      released = true;
      await store.incrFloat(key, -1);
    },
  };
}

const BUSY_TTL_SEC = 120;

/** One answer at a time per profile (two tabs, a double press). Returns a release function, or null when busy. */
export async function lockAnswer(profileId: string, token: string): Promise<(() => Promise<void>) | null> {
  const store = getStore();
  const ok = await store.setNx(busyKey(profileId), token, BUSY_TTL_SEC);
  if (!ok) return null;
  return async () => {
    await store.delIfEquals(busyKey(profileId), token).catch(() => false);
  };
}
