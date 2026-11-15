'use client';

import { ArrowDown, Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { CategorySwatch } from '@/components/kit/Evidence';
import { KeystoneMark } from '@/components/kit/Mark';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { sendToCoach, type CoachEvent, type CoachMessage, type CoachStarter } from './api';
import { Composer } from './Composer';
import { Markdown } from './Markdown';
import { VoiceGlyph, clock } from './Waveform';
import type { PreparedVoice } from './wav';
import st from './coach.module.css';

/** A message on screen: the saved shape plus the state of one that is still on its way. */
export interface UiMessage extends CoachMessage {
  state?: 'transcribing' | 'waiting' | 'streaming' | 'failed' | 'cutoff';
  error?: string;
  peaks?: number[];
  /** The recording, kept in this tab only until its transcript arrives, so a failed voice message can be resent. */
  voice?: PreparedVoice;
}

const newId = () => {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `u_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
};
const pendingId = (id: string) => `p_${id}`;

export function CoachAvatar() {
  return (
    <span className={st.avatar} aria-hidden="true">
      <KeystoneMark size={26} tone="paper" />
    </span>
  );
}

export function UserLine({ m, children }: { m: UiMessage; children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className={st.userRow} data-failed={m.state === 'failed' || undefined}>
      <div className={st.userPlate}>
        <span className="sr-only">{t('coach.msg.you')}: </span>
        {m.via === 'voice' ? (
          <span className={st.voiceHead}>
            <VoiceGlyph peaks={m.peaks} seconds={m.seconds} />
            <span className="sr-only">{t('coach.voice.label', { time: clock(m.seconds ?? 0) })}</span>
          </span>
        ) : null}
        {m.state === 'transcribing' ? <span className={st.transcribing}>{t('coach.voice.transcribing')}</span> : m.text ? <p className={st.userText}>{m.text}</p> : null}
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={st.copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked: the text stays selectable */
        }
      }}
    >
      {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span>{done ? t('coach.msg.copied') : t('coach.msg.copy')}</span>
    </button>
  );
}

export function CoachLine({ m, actions = true }: { m: UiMessage; actions?: boolean }) {
  const { t } = useT();
  const live = m.state === 'waiting' || m.state === 'streaming';
  return (
    <div className={st.coachRow} data-state={m.state}>
      <CoachAvatar />
      <div className={st.coachBody}>
        <span className="sr-only">{t('coach.msg.coach')}: </span>
        {m.state === 'waiting' ? (
          <p className={st.waiting}>
            <span className={st.dots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t('coach.msg.answering')}
          </p>
        ) : (
          <Markdown text={m.text} caret={m.state === 'streaming'} />
        )}
        {m.stopped ? <p className={st.lineNote}>{t('coach.msg.stopped')}</p> : null}
        {m.state === 'cutoff' ? <p className={st.lineNote}>{t('coach.msg.cutOff')}</p> : null}
        {actions && !live && m.text && m.state !== 'cutoff' ? (
          <div className={st.lineActions}>
            <CopyButton text={m.text} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function errorText(t: ReturnType<typeof useT>['t'], code: string, cap: number): string {
  const known = ['coach_failed', 'stopped', 'no_speech', 'transcribe_failed', 'budget', 'rate_limited', 'coach_cap', 'coach_busy', 'network', 'voice_too_long', 'voice_invalid', 'coach_required'];
  return t(`coach.errors.${known.includes(code) ? code : 'coach_failed'}`, { cap });
}

export interface CoachChatProps {
  initial: CoachMessage[];
  starters: CoachStarter[];
  left: number;
  cap: number;
  onMessagesChange?(count: number): void;
}

/**
 * The conversation. A message shows at once with a client id; the answer streams in under the keystone
 * mark. A failure keeps the person's text in its bubble with «Send again»; Stop keeps what already arrived.
 * New words follow the bottom only while the reader is there.
 */
export function CoachChat({ initial, starters, left: initialLeft, cap, onMessagesChange }: CoachChatProps) {
  const { t } = useT();
  const [msgs, setMsgs] = useState<UiMessage[]>(initial);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(initialLeft);
  const [announce, setAnnounce] = useState('');
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);

  useEffect(() => onMessagesChange?.(msgs.length), [msgs.length, onMessagesChange]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    nearEnd.current = near;
    setAwayFromEnd(!near);
  };
  const toEnd = (smooth = false) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    nearEnd.current = true;
    setAwayFromEnd(false);
  };
  useLayoutEffect(() => {
    if (nearEnd.current) toEnd();
  }, [msgs]);

  const patch = (id: string, fn: (m: UiMessage) => UiMessage | null) =>
    setMsgs((list) => list.flatMap((m) => {
      if (m.id !== id) return [m];
      const next = fn(m);
      return next ? [next] : [];
    }));

  const send = useCallback(
    async (input: { text?: string; voice?: PreparedVoice }, reuseId?: string) => {
      if (abortRef.current) return;
      const id = reuseId ?? newId();
      const at = new Date().toISOString();
      const voice = input.voice;
      const user: UiMessage = voice
        ? { id, role: 'user', text: '', at, via: 'voice', seconds: Math.round(voice.seconds), peaks: voice.peaks, voice, state: 'transcribing' }
        : { id, role: 'user', text: input.text ?? '', at };
      const coachId = pendingId(id);
      nearEnd.current = true;
      setMsgs((list) => [...list.filter((m) => m.id !== id && m.id !== coachId), user, { id: coachId, role: 'coach', text: '', at, state: 'waiting' }]);
      setBusy(true);
      setAnnounce(t('coach.msg.answering'));
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const fail = (code: string, transcript?: string) => {
        patch(id, (m) => ({ ...m, state: 'failed', error: code, ...(transcript ? { text: transcript, voice: undefined } : {}) }));
        patch(coachId, (m) => (m.text.trim() ? { ...m, state: 'cutoff' } : null));
        setAnnounce(errorText(t, code, cap));
      };

      const onEvent = (e: CoachEvent) => {
        if (ctrl.signal.aborted) return;
        switch (e.t) {
          case 'transcript':
            patch(id, (m) => ({ ...m, text: e.text, seconds: e.seconds, state: undefined, voice: undefined }));
            break;
          case 'delta':
            patch(coachId, (m) => ({ ...m, text: m.text + e.text, state: 'streaming' }));
            break;
          case 'done':
            patch(id, (m) => ({ ...m, state: undefined, error: undefined, voice: undefined }));
            patch(coachId, () => ({ ...e.message }));
            setLeft(e.left);
            setAnnounce(t('coach.msg.ready'));
            break;
          case 'error':
            fail(e.code, e.transcript);
            break;
        }
      };

      try {
        await sendToCoach({ id, ...(voice ? { audio: { format: 'wav', data: voice.base64 } } : { text: input.text }) }, onEvent, ctrl.signal);
      } catch (err) {
        if (!ctrl.signal.aborted) fail(err instanceof ApiError ? err.code : 'network');
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setBusy(false);
        }
      }
    },
    [cap, t],
  );

  const stop = () => {
    const ctrl = abortRef.current;
    if (!ctrl) return;
    ctrl.abort();
    abortRef.current = null;
    setBusy(false);
    setMsgs((list) => {
      const last = list[list.length - 1];
      const prev = list[list.length - 2];
      if (!last || last.role !== 'coach' || !prev) return list;
      if (last.text.trim()) return [...list.slice(0, -1), { ...last, id: last.id.replace(/^p_/, 's_'), state: undefined, stopped: true }];
      // nothing arrived yet: the person's message stays with «Send again»
      return [...list.slice(0, -2), { ...prev, state: 'failed', error: 'stopped' }];
    });
  };

  const resend = (m: UiMessage) => {
    if (busy) return;
    setMsgs((list) => list.filter((x) => x.id !== pendingId(m.id)));
    if (m.voice && !m.text) void send({ voice: m.voice }, m.id);
    else if (m.text) void send({ text: m.text }, m.id);
  };

  const empty = msgs.length === 0;

  return (
    <>
      <div className={st.log} ref={logRef} onScroll={onScroll} role="log" aria-label={t('coach.title')} aria-live="off">
        {empty ? (
          <div className={st.empty}>
            <h2 className={st.emptyTitle}>{t('coach.empty.title')}</h2>
            <p className={st.emptyLead}>{t('coach.empty.lead')}</p>
          </div>
        ) : (
          <ol className={st.thread}>
            {msgs.map((m) => (
              <li key={m.id}>
                {m.role === 'user' ? (
                  <UserLine m={m}>
                    {m.state === 'failed' ? (
                      <div className={st.failRow} role="alert">
                        <span>{errorText(t, m.error ?? 'coach_failed', cap)}</span>
                        {m.error !== 'coach_cap' && m.error !== 'coach_required' && (m.text || m.voice) ? (
                          <Button size="sm" variant="secondary" onClick={() => resend(m)} disabled={busy}>
                            {t('coach.errors.sendAgain')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </UserLine>
                ) : (
                  <CoachLine m={m} />
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      {awayFromEnd && !empty ? (
        <button type="button" className={st.jump} onClick={() => toEnd(true)}>
          <ArrowDown size={16} aria-hidden="true" />
          {t('coach.msg.jump')}
        </button>
      ) : null}
      {empty && starters.length ? (
        // quick questions as small chips above the composer, so the conversation keeps the room
        <ul className={st.chips} aria-label={t('coach.empty.chips')}>
          {starters.map((s, i) => (
            <li key={s.q} style={{ animationDelay: `${60 + i * 50}ms` }}>
              <button type="button" className={st.chip} onClick={() => void send({ text: s.q })} disabled={busy} title={s.basis || undefined}>
                {s.cat ? <CategorySwatch category={s.cat} size="sm" /> : null}
                <span>{s.q}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Composer busy={busy} onSend={(text) => void send({ text })} onVoice={(voice) => void send({ voice })} onStop={stop} left={left} />
    </>
  );
}
