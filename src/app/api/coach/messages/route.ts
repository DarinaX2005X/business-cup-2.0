import { z } from 'zod';
import { HttpError, readJson, withApi } from '@/server/profile/http';
import { MESSAGE_MAX_CHARS } from '@/server/ai/prompts/coach';
import { coachCtx } from '@/server/coach/http';
import { ask } from '@/server/coach/service';
import { MAX_VOICE_SECONDS, MAX_WAV_BYTES, wavInfo } from '@/server/coach/transcribe';

export const maxDuration = 300;

const bodySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  text: z.string().max(MESSAGE_MAX_CHARS + 200).optional(),
  // base64 of a 16 kHz mono PCM WAV made in the browser (src/components/coach/wav.ts)
  audio: z.object({ format: z.literal('wav'), data: z.string().max(Math.ceil((MAX_WAV_BYTES * 4) / 3) + 8) }).optional(),
});

/**
 * POST /api/coach/messages { id, text } or { id, audio: { format: 'wav', data } } → NDJSON stream of
 * CoachEvent (src/server/coach/types.ts). Errors before the stream opens are JSON: 400 invalid_input,
 * voice_too_long, voice_invalid; 402 coach_required; 409 coach_busy; 429 coach_cap.
 * The audio is transcribed in memory and never stored.
 */
export const POST = withApi(async (req: Request) => {
  const ctx = await coachCtx(req);
  const body = await readJson(req, bodySchema);
  let voice: { base64: string; seconds: number } | undefined;
  if (body.audio) {
    const bytes = Buffer.from(body.audio.data, 'base64');
    if (bytes.length > MAX_WAV_BYTES) throw new HttpError(400, 'voice_too_long', `Voice messages are limited to ${MAX_VOICE_SECONDS} seconds.`);
    const info = wavInfo(bytes);
    if (!info) throw new HttpError(400, 'voice_invalid', 'The recording is not a PCM WAV file.');
    if (info.seconds > MAX_VOICE_SECONDS + 1.5) throw new HttpError(400, 'voice_too_long', `Voice messages are limited to ${MAX_VOICE_SECONDS} seconds.`);
    if (info.seconds < 0.4) throw new HttpError(400, 'voice_invalid', 'The recording is too short.');
    voice = { base64: body.audio.data, seconds: info.seconds };
  }
  const text = body.text?.trim().slice(0, MESSAGE_MAX_CHARS);
  const stream = await ask(ctx, { id: body.id, text, voice }, req.signal);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
