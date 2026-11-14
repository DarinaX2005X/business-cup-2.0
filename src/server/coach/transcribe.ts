import { AiError, type ReasoningEffort } from '@/server/ai/client';
import type { Actor } from '@/server/ai/budget';
import { completeText } from './stream';

/**
 * Speech to text for coach voice messages. OpenRouter has no ElevenLabs Scribe or Whisper model
 * (checked against GET /api/v1/models on 2026-11-15), so a model that takes `input_audio` writes the
 * transcript. Measured on the same recordings (2026-11-15, billed `usage.cost`):
 * - google/gemini-2.5-flash-lite: $0.30 per 1M audio tokens (32 a second), about $0.0007 a minute; accurate
 *   on clear speech. First choice.
 * - mistralai/voxtral-small-24b-2507: a speech model, about $0.0057 a minute; best on a hard synthetic
 *   voice. Failover.
 * - google/gemini-3.8-flash: the product model, about $0.0022 a minute. Last failover.
 * Failover happens on errors and empty answers. COACH_STT_MODELS (comma separated) overrides the list.
 *
 * The audio exists only in this request's memory: it is not stored, cached or logged.
 */

export const MAX_VOICE_SECONDS = 60;
/** 60 s of 16 kHz mono 16-bit PCM is 1.92 MB; a little room for the header and a slower clock. */
export const MAX_WAV_BYTES = 2_200_000;

export const STT_MODELS = ['google/gemini-2.5-flash-lite', 'mistralai/voxtral-small-24b-2507', 'google/gemini-3.8-flash'];

export function sttModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = env.COACH_STT_MODELS?.split(',').map((s) => s.trim()).filter(Boolean);
  return list?.length ? list : STT_MODELS;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  seconds: number;
}

/** Reads a PCM WAV header; null when the bytes are not a WAV file this endpoint accepts. */
export function wavInfo(buf: Uint8Array): WavInfo | null {
  if (buf.length < 44) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bits: number } | null = null;
  let dataBytes = -1;
  while (pos + 8 <= buf.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    const start = pos + 8;
    if (id === 'fmt ' && start + 16 <= buf.length) {
      fmt = {
        format: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        byteRate: view.getUint32(start + 8, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - start);
      break;
    }
    pos = start + size + (size % 2);
  }
  if (!fmt || dataBytes < 0 || fmt.format !== 1 || !fmt.byteRate || fmt.channels < 1 || fmt.channels > 2) return null;
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 48000) return null;
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, dataBytes, seconds: dataBytes / fmt.byteRate };
}

const SYSTEM = [
  'You transcribe short voice messages that a person records for their career coach.',
  'Write exactly the words spoken, in the language spoken, with normal punctuation and capital letters.',
  'Do not answer the message, summarise, translate, correct facts or add any words of your own.',
  'Leave out filler sounds such as "um" and "uh".',
  'If there is no clear speech in the recording, write exactly NO_SPEECH and nothing else.',
].join(' ');

/** Token count of audio for Gemini models (32 tokens per second) and a generous price, for the budget reservation. */
const estimate = (seconds: number) => () => (seconds * 32 + 300) * 0.000002 + 600 * 0.000005;

export class NoSpeechError extends Error {
  readonly code = 'no_speech';
  constructor() {
    super('no speech in the recording');
    this.name = 'NoSpeechError';
  }
}

export async function transcribe(input: { wavBase64: string; seconds: number; actor?: Actor; signal?: AbortSignal; reasoning?: ReasoningEffort }): Promise<{ text: string; model: string; costUsd: number }> {
  const { text, usage } = await completeText({
    op: 'coach.transcribe',
    models: sttModels(),
    reasoning: input.reasoning ?? 'off',
    maxTokens: 600,
    temperature: 0,
    actor: input.actor,
    signal: input.signal,
    estimateUsd: estimate(input.seconds),
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this voice message.' },
          { type: 'input_audio', input_audio: { data: input.wavBase64, format: 'wav' } },
        ],
      },
    ],
  });
  const clean = cleanTranscript(text);
  if (!clean) throw new NoSpeechError();
  return { text: clean, model: usage.model, costUsd: usage.costUsd };
}

/** Strips wrapping quotes and labels a model sometimes adds; empty for «no speech». */
export function cleanTranscript(raw: string): string {
  let t = raw.trim();
  if (/^no[_ ]?speech\.?$/i.test(t)) return '';
  t = t.replace(/^(transcript(ion)?|text)\s*:\s*/i, '');
  if (/^["“][\s\S]*["”]$/.test(t)) t = t.slice(1, -1).trim();
  if (/NO_SPEECH/.test(t) && t.length < 20) return '';
  return t.slice(0, 2000);
}

export function isNoSpeech(err: unknown): err is NoSpeechError {
  return err instanceof NoSpeechError;
}

export { AiError };
