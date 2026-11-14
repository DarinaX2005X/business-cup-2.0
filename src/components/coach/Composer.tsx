'use client';

import { Mic, SendHorizontal, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '@/i18n/client';
import { MESSAGE_MAX_CHARS } from '@/server/coach/limits';
import { useVoiceRecorder } from './useVoiceRecorder';
import { clock, LiveWaveform } from './Waveform';
import type { PreparedVoice } from './wav';
import st from './coach.module.css';

const DRAFT_KEY = 'irr_coach_draft';
/** Sliding this far from where the press began cancels the recording. */
const CANCEL_PX = 90;

function readDraft(): string {
  try {
    return window.localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeDraft(v: string) {
  try {
    if (v) window.localStorage.setItem(DRAFT_KEY, v);
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: the draft lives while the page is open */
  }
}

export interface ComposerProps {
  /** An answer is on its way: the send button becomes Stop. */
  busy: boolean;
  onSend(text: string): void;
  onVoice(voice: PreparedVoice): void;
  onStop(): void;
  left: number;
}

/**
 * The composer: a text box with two round controls inside it. The apricot mic records while held (the
 * person's own voice is the human part) and turns the box into a live waveform; the violet button sends,
 * or stops an answer that is still arriving. The draft survives a reload in this browser.
 * It mounts only on the client (after /api/coach answered), so the draft can be read on the first render.
 */
export function Composer({ busy, onSend, onVoice, onStop, left }: ComposerProps) {
  const { t } = useT();
  const [text, setText] = useState(() => (typeof window === 'undefined' ? '' : readDraft()));
  const [cancelling, setCancelling] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const rec = useVoiceRecorder(onVoice);
  const recording = rec.state === 'recording' || rec.state === 'starting';

  useEffect(() => writeDraft(text), [text]);

  // the box grows with the text up to six lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text, recording]);

  // Esc cancels a recording wherever the focus is
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        press.current = null;
        rec.stop(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording, rec]);

  const submit = () => {
    const v = text.trim();
    if (!v || busy) return;
    onSend(v.slice(0, MESSAGE_MAX_CHARS));
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const micDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (busy || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setCancelling(false);
    void rec.start();
  };
  const micMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    setCancelling(Math.hypot(e.clientX - p.x, e.clientY - p.y) > CANCEL_PX);
  };
  const micUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    const away = Math.hypot(e.clientX - p.x, e.clientY - p.y) > CANCEL_PX;
    setCancelling(false);
    rec.stop(!away);
  };
  const micCancel = () => {
    if (!press.current) return;
    press.current = null;
    setCancelling(false);
    rec.stop(false);
  };
  // keyboard: hold Space or Enter on the mic
  const micKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !busy) {
      e.preventDefault();
      void rec.start();
    }
  };
  const micKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      rec.stop(true);
    }
  };

  const problem = rec.problem ? t(`coach.voice.${rec.problem}`) : null;
  const low = left <= 20;

  return (
    <div className={st.composerWrap}>
      {problem ? (
        <p className={st.composerNote} role="alert">
          {problem}
        </p>
      ) : low ? (
        <p className={st.composerNote}>{t('coach.composer.left', { count: left })}</p>
      ) : null}
      <form
        className={st.composer}
        data-recording={recording || undefined}
        data-cancelling={cancelling || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {recording || rec.state === 'processing' ? (
          <div className={st.recStrip} aria-live="polite">
            <span className={st.recDot} aria-hidden="true" />
            <span className={st.recTime}>
              {clock(rec.elapsed)}
              <small> / 1:00</small>
            </span>
            {rec.state === 'processing' ? <span className={st.recNote}>{t('coach.composer.processing')}</span> : <LiveWaveform analyser={rec.analyser} />}
            <span className={st.recHint}>{rec.state === 'processing' ? null : cancelling ? t('coach.composer.cancelling') : t('coach.composer.release')}</span>
          </div>
        ) : (
          <>
            <label htmlFor="coach-input" className="sr-only">
              {t('coach.composer.label')}
            </label>
            <textarea
              id="coach-input"
              ref={area}
              className={st.input}
              rows={1}
              value={text}
              maxLength={MESSAGE_MAX_CHARS}
              placeholder={t('coach.composer.placeholder')}
              aria-describedby="coach-keys"
              onChange={(e) => {
                setText(e.target.value);
                if (rec.problem) rec.clearProblem();
              }}
              onKeyDown={onKey}
            />
            <span id="coach-keys" className="sr-only">
              {t('coach.composer.keys')}
            </span>
          </>
        )}
        <div className={st.controls}>
          <button
            type="button"
            className={st.mic}
            data-on={recording || undefined}
            aria-label={t('coach.composer.mic')}
            title={t('coach.composer.micHint')}
            aria-disabled={busy || rec.state === 'processing' || undefined}
            onPointerDown={micDown}
            onPointerMove={micMove}
            onPointerUp={micUp}
            onPointerCancel={micCancel}
            onKeyDown={micKeyDown}
            onKeyUp={micKeyUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Mic size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          {busy ? (
            <button type="button" className={st.send} data-stop onClick={onStop} aria-label={t('coach.composer.stop')} title={t('coach.composer.stop')}>
              <Square size={15} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className={st.send} aria-label={t('coach.composer.send')} title={t('coach.composer.send')} aria-disabled={!text.trim() || recording || undefined}>
              <SendHorizontal size={19} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
