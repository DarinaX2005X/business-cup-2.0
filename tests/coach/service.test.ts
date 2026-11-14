import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { readHistory, messagesLeft, DAILY_CAP } from '@/server/coach/history';
import { ask, coachState } from '@/server/coach/service';
import { encodeWav, toBase64 } from '@/components/coach/wav';
import type { CoachEvent } from '@/server/coach/types';
import type { Profile } from '@/domain/types';
import { useTempStore } from '../platform/helpers';

/**
 * The coach's answer path with OpenRouter replaced by a scripted fetch: streaming, failover to the other
 * model before any words, an error after the first words, transcription of a voice message, the plan gate
 * and the daily cap. Nothing here calls the network.
 */

const fetchMock = vi.fn<typeof fetch>();
let cleanup: () => void;

function sse(pieces: string[], opts: { failAfter?: number } = {}): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pieces.forEach((p, i) => {
        if (opts.failAfter !== undefined && i === opts.failAfter) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ error: { code: 502, message: 'upstream died' } })}\n\n`));
          return;
        }
        if (opts.failAfter !== undefined && i > opts.failAfter) return;
        c.enqueue(enc.encode(`: OPENROUTER PROCESSING\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      });
      if (opts.failAfter === undefined) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0002 } })}\n\ndata: [DONE]\n\n`));
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const fail = (status: number) => new Response(JSON.stringify({ error: { code: status, message: 'busy' } }), { status, headers: { 'Content-Type': 'application/json' } });

async function events(stream: ReadableStream<Uint8Array>): Promise<CoachEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CoachEvent);
}

const sentModels = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model as string);

async function maxProfile(): Promise<Profile> {
  const { profile } = await createProfile({ locale: 'en' });
  const { profile: next } = await updateProfile(profile.id, (p) => {
    p.plan = { status: 'pro', source: 'cup', tier: 'coach', periodEnd: new Date(Date.now() + 10 * 86_400_000).toISOString() } as Profile['plan'];
  });
  return next;
}

beforeEach(() => {
  ({ cleanup } = useTempStore());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-3.8-flash');
  vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
  vi.stubEnv('AI_BUDGET_USD', '1');
  vi.stubEnv('AI_DAILY_CAP_USD', '1');
  vi.stubEnv('AI_BACKOFF_MS', '0');
  vi.stubEnv('DEV_FORCE_PRO', '');
  vi.stubEnv('DEV_FORCE_COACH', '');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('coach answer stream', () => {
  it('streams the answer, then saves the exchange and counts one message', async () => {
    const profile = await maxProfile();
    fetchMock.mockResolvedValueOnce(sse(['Start with ', '**charting**.']));
    const ev = await events(await ask({ profile, ip: '1.2.3.4' }, { id: 'msg_00000001', text: 'Which task first?' }));

    expect(ev.map((e) => e.t)).toEqual(['accepted', 'delta', 'delta', 'done']);
    const done = ev.at(-1) as Extract<CoachEvent, { t: 'done' }>;
    expect(done.message.text).toBe('Start with **charting**.');
    expect(done.left).toBe(DAILY_CAP - 1);

    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toContain('## CONTEXT');
    expect(sent.messages[0].content).toContain('no week map yet');
    expect(sent.messages.at(-1)).toEqual({ role: 'user', content: 'Which task first?' });

    const saved = await readHistory(profile.id);
    expect(saved.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Which task first?'],
      ['coach', 'Start with **charting**.'],
    ]);
    expect(await messagesLeft(profile.id)).toBe(DAILY_CAP - 1);
  });

  it('retries, then fails over to the other model before any words reach the person', async () => {
    const profile = await maxProfile();
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(sse(['Answer from the partner.']));
    const ev = await events(await ask({ profile, ip: null }, { id: 'msg_00000002', text: 'Hi' }));
    expect(ev.at(-1)?.t).toBe('done');
    expect(sentModels()).toEqual(['google/gemini-3.8-flash', 'google/gemini-3.8-flash', 'openai/gpt-6-luna']);
    // gpt-6 endpoints reject temperature
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).temperature).toBeUndefined();
  });

  it('when both models fail it says so, saves nothing and gives the message back', async () => {
    const profile = await maxProfile();
    fetchMock.mockImplementation(async () => fail(500));
    const ev = await events(await ask({ profile, ip: null }, { id: 'msg_00000003', text: 'Hi' }));
    expect(ev.map((e) => e.t)).toEqual(['accepted', 'error']);
    expect(ev[1]).toMatchObject({ code: 'coach_failed' });
    expect((await readHistory(profile.id)).messages).toEqual([]);
    expect(await messagesLeft(profile.id)).toBe(DAILY_CAP);
  });

  it('an error after the first words ends the answer without saving half of it', async () => {
    const profile = await maxProfile();
    fetchMock.mockResolvedValueOnce(sse(['First words ', 'and more'], { failAfter: 1 }));
    const ev = await events(await ask({ profile, ip: null }, { id: 'msg_00000004', text: 'Hi' }));
    expect(ev.map((e) => e.t)).toEqual(['accepted', 'delta', 'error']);
    // no failover once words were shown: one call only
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readHistory(profile.id)).messages).toEqual([]);
  });

  it('a voice message is transcribed first, shown, then answered; the audio is not stored', async () => {
    const profile = await maxProfile();
    const wav = encodeWav(new Float32Array(16_000 * 2).map((_, i) => Math.sin(i / 7) * 0.3));
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'What should I learn next?' } }], usage: { prompt_tokens: 80, completion_tokens: 8, cost: 0.00003 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(sse(['Start with care planning.']));
    const ev = await events(await ask({ profile, ip: null }, { id: 'msg_00000005', voice: { base64: toBase64(wav), seconds: 2 } }));
    expect(ev.map((e) => e.t)).toEqual(['accepted', 'transcript', 'delta', 'done']);
    expect(ev[1]).toMatchObject({ text: 'What should I learn next?', seconds: 2 });

    const stt = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(stt.model).toBe('google/gemini-2.5-flash-lite');
    expect(stt.messages[1].content[1].type).toBe('input_audio');
    const chat = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(chat.messages.at(-1).content).toBe('(voice message, transcript) What should I learn next?');

    const saved = await readHistory(profile.id);
    expect(saved.messages[0]).toMatchObject({ role: 'user', via: 'voice', seconds: 2, text: 'What should I learn next?' });
    expect(JSON.stringify(saved)).not.toContain(toBase64(wav).slice(0, 40));
  });

  it('a recording without words ends with no_speech and nothing else', async () => {
    const profile = await maxProfile();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'NO_SPEECH' } }], usage: { cost: 0 } }), { status: 200 }));
    const wav = encodeWav(new Float32Array(16_000));
    const ev = await events(await ask({ profile, ip: null }, { id: 'msg_00000006', voice: { base64: toBase64(wav), seconds: 1 } }));
    expect(ev.map((e) => e.t)).toEqual(['accepted', 'error']);
    expect(ev[1]).toMatchObject({ code: 'no_speech' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a resend of a saved message returns the saved answer without a model call', async () => {
    const profile = await maxProfile();
    fetchMock.mockResolvedValueOnce(sse(['Saved answer.']));
    await events(await ask({ profile, ip: null }, { id: 'msg_00000007', text: 'Hi' }));
    const again = await events(await ask({ profile, ip: null }, { id: 'msg_00000007', text: 'Hi' }));
    expect(again.map((e) => e.t)).toEqual(['accepted', 'done']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('coach access', () => {
  it('Free and Pro get a locked state and cannot send', async () => {
    const { profile } = await createProfile({ locale: 'en' });
    const state = await coachState({ profile, ip: null });
    expect(state).toMatchObject({ access: 'locked', tier: 'free', hasMap: false, messages: [] });
    expect(state.starters.length).toBeGreaterThan(0);
    await expect(ask({ profile, ip: null }, { id: 'msg_00000008', text: 'Hi' })).rejects.toMatchObject({ status: 402, code: 'coach_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Max (the Business Cup plan included) opens the conversation', async () => {
    const profile = await maxProfile();
    const state = await coachState({ profile: (await getProfile(profile.id))!, ip: null });
    expect(state.access).toBe('coach');
  });

  it('stops at the daily cap', async () => {
    const profile = await maxProfile();
    const { getStore } = await import('@/server/store');
    const { capKey } = await import('@/server/coach/history');
    const { dayKey } = await import('@/server/ai/budget');
    await getStore().incrFloat(capKey(profile.id, dayKey()), DAILY_CAP);
    await expect(ask({ profile, ip: null }, { id: 'msg_00000009', text: 'Hi' })).rejects.toMatchObject({ status: 429, code: 'coach_cap' });
  });
});
