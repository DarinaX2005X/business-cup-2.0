'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WeekShare } from '@/domain/types';
import { ApiError, apiFetch } from '@/lib/client/api';
import { loadCredentials } from '@/lib/client/credentials';
import type { XrayData } from './types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 800;
const SAVED_MS = 1500;

/**
 * Saves the edited week into the same map: PATCH with debounce and the current version, one request at
 * a time (a change made during a request is sent right after it), sendBeacon when the page goes away
 * with an unsaved change, and 409 → the server's map wins and the screen is told about it.
 */
export function useWeekSave({
  id,
  initialVersion,
  onServer,
  onConflict,
}: {
  id: string;
  initialVersion: number;
  /** A saved map came back: adopt its version (and shares, in case the server normalised them). */
  onServer: (x: XrayData) => void;
  /** Another tab changed the map: apply the server copy. */
  onConflict: (x: XrayData) => void;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const version = useRef(initialVersion);
  const pending = useRef<WeekShare[] | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  const cbs = useRef({ onServer, onConflict });
  useEffect(() => {
    cbs.current = { onServer, onConflict };
  }, [onServer, onConflict]);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (inFlight.current || !pending.current) return;
    const shares = pending.current;
    pending.current = null;
    inFlight.current = true;
    setState('saving');
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    try {
      const x = await apiFetch<XrayData>(`/api/xray/${id}`, { method: 'PATCH', body: { shares, version: version.current }, keepalive: true });
      version.current = x.version;
      if (!pending.current) cbs.current.onServer(x);
      setState('saved');
      savedTimer.current = window.setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), SAVED_MS);
    } catch (err) {
      const current = err instanceof ApiError && err.status === 409 ? (err.body as { xray?: XrayData } | null)?.xray : null;
      if (current) {
        version.current = current.version;
        pending.current = null;
        cbs.current.onConflict(current);
        setState('idle');
      } else {
        // keep the change so Retry and the next edit still send it
        pending.current ??= shares;
        setState('error');
      }
    } finally {
      inFlight.current = false;
      if (pending.current && timer.current === null) timer.current = window.setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
    }
  }, [id]);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(
    (shares: WeekShare[]) => {
      pending.current = shares;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  const retry = useCallback(() => void flush(), [flush]);

  /** After a 409 or a reset the screen may adopt a version it got elsewhere. */
  const setVersion = useCallback((v: number) => {
    version.current = v;
  }, []);

  // Leaving the page with an unsaved change: hand it to the browser to deliver (sendBeacon).
  useEffect(() => {
    const send = () => {
      if (!pending.current) return;
      const creds = loadCredentials();
      if (!creds || !navigator.sendBeacon) return;
      const body = JSON.stringify({ shares: pending.current, version: version.current, auth: creds });
      if (navigator.sendBeacon(`/api/xray/${id}`, new Blob([body], { type: 'text/plain' }))) pending.current = null;
    };
    // Tab hidden: save now with a normal request (keepalive), so the answer still updates the version.
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', send);
      document.removeEventListener('visibilitychange', onHide);
      send();
    };
  }, [id, flush]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  return { state, schedule, retry, setVersion };
}
