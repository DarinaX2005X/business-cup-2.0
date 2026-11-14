'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareVoice, VOICE_MAX_SECONDS, type PreparedVoice } from './wav';

/**
 * Hold-to-talk recording with MediaRecorder. `start()` on press, `stop(true)` on release sends, `stop(false)`
 * cancels. An AnalyserNode on the same microphone stream feeds the live waveform. The recording stops by
 * itself at VOICE_MAX_SECONDS and is handed over as WAV; nothing is kept after `onRecorded`.
 */

export type RecorderState = 'idle' | 'starting' | 'recording' | 'processing';
export type RecorderProblem = 'denied' | 'unsupported' | 'too_short' | 'failed' | null;

/** A press shorter than this is a tap: the person gets the «hold to talk» hint instead of a message. */
const MIN_MS = 600;

export function useVoiceRecorder(onRecorded: (voice: PreparedVoice) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [problem, setProblem] = useState<RecorderProblem>(null);
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const rec = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    chunks: Blob[];
    ctx: AudioContext;
    startedAt: number;
    timer: ReturnType<typeof setInterval>;
    send: boolean;
  } | null>(null);
  /** Release arrived while the microphone was still opening. */
  const pendingStop = useRef<boolean | null>(null);
  const cb = useRef(onRecorded);
  useEffect(() => {
    cb.current = onRecorded;
  });

  const teardown = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
    rec.current = null;
    setAnalyser(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(
    (send: boolean) => {
      const r = rec.current;
      if (!r) {
        if (state === 'starting') pendingStop.current = send;
        return;
      }
      const ms = Date.now() - r.startedAt;
      r.send = send && ms >= MIN_MS;
      if (send && ms < MIN_MS) setProblem('too_short');
      if (r.recorder.state !== 'inactive') r.recorder.stop();
      else teardown();
    },
    [state, teardown],
  );

  const start = useCallback(async () => {
    if (rec.current || state === 'starting') return;
    setProblem(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setProblem('unsupported');
      return;
    }
    setState('starting');
    pendingStop.current = null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (err) {
      setState('idle');
      setProblem((err as Error).name === 'NotAllowedError' || (err as Error).name === 'SecurityError' ? 'denied' : 'unsupported');
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(node);
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        const r = rec.current;
        const send = r?.send ?? false;
        const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
        teardown();
        setElapsed(0);
        if (!send || !chunks.length) {
          setState('idle');
          return;
        }
        setState('processing');
        try {
          const voice = await prepareVoice(new Blob(chunks, { type }));
          setState('idle');
          if (voice.seconds < MIN_MS / 1000) setProblem('too_short');
          else cb.current(voice);
        } catch {
          setState('idle');
          setProblem('failed');
        }
      };
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setElapsed(s);
        if (s >= VOICE_MAX_SECONDS && recorder.state === 'recording') {
          if (rec.current) rec.current.send = true;
          recorder.stop();
        }
      }, 200);
      rec.current = { stream, recorder, chunks, ctx, startedAt, timer, send: false };
      recorder.start(250);
      setAnalyser(node);
      setElapsed(0);
      setState('recording');
      if (pendingStop.current !== null) {
        // released before the microphone opened: that was a tap
        const send = pendingStop.current;
        pendingStop.current = null;
        rec.current.send = false;
        if (send) setProblem('too_short');
        recorder.stop();
      }
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setState('idle');
      setProblem('failed');
    }
  }, [state, teardown]);

  return { state, problem, clearProblem: () => setProblem(null), elapsed, analyser, start, stop };
}
