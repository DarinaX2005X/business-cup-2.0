import { ApiError, apiFetch, profileHeaders } from '@/lib/client/api';
import type { CoachEvent, CoachPreview, CoachState } from '@/server/coach/types';

export type { CoachEvent, CoachMessage, CoachPreview, CoachSnapshot, CoachStarter, CoachState } from '@/server/coach/types';

export const getCoach = () => apiFetch<CoachState>('/api/coach');
export const newChat = () => apiFetch<{ ok: true }>('/api/coach', { method: 'DELETE' });
export const getPreview = () => apiFetch<CoachPreview>('/api/coach/preview', { method: 'POST' });

export interface SendBody {
  id: string;
  text?: string;
  audio?: { format: 'wav'; data: string };
}

/**
 * POST /api/coach/messages and read the NDJSON stream, calling `onEvent` for every line as it arrives.
 * Throws ApiError for a refusal before the stream (402, 409, 429 …) or a lost connection; a stream that
 * ends without `done` or `error` reports `coach_failed`, so the screen never waits forever.
 */
export async function sendToCoach(body: SendBody, onEvent: (e: CoachEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/coach/messages', {
      method: 'POST',
      headers: { ...profileHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    throw new ApiError('network', 0, 'Network request failed');
  }
  if (!res.ok || !res.body) {
    let code = res.status >= 500 ? 'server_error' : 'invalid_input';
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(code, res.status, message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!raw) continue;
        let e: CoachEvent;
        try {
          e = JSON.parse(raw) as CoachEvent;
        } catch {
          continue;
        }
        if (e.t === 'done' || e.t === 'error') ended = true;
        onEvent(e);
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError' || signal.aborted) return;
    if (!ended) onEvent({ t: 'error', code: 'coach_failed' });
    return;
  }
  if (!ended && !signal.aborted) onEvent({ t: 'error', code: 'coach_failed' });
}
