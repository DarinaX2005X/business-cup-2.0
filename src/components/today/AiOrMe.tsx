'use client';

import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Button } from '@/components/kit/Button';
import { sound } from '@/components/kit/sound';
import type { AiOrMeCard, AiOrMeRoundFull } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { errorCode, errorKey, submitAiOrMe } from './api';
import { reducedMotion } from './hooks';
import sa from './aiorme.module.css';

type Answer = 'ai' | 'human';
const REVEAL_MS = 1400;
const FLIP_MS = 300;
const EXIT_MS = 360;
const SWIPE_AT = 0.3;
/** The fact stays on screen at least this long before a press may skip it (a double click must not). */
const MIN_READ_MS = 700;

function factLines(t: ReturnType<typeof useT>['t'], card: AiOrMeCard): string[] {
  const out: string[] = [];
  if (typeof card.fact.params.hours === 'number') out.push(t('today.aiOrMe.hours', { hours: card.fact.params.hours }));
  out.push(t(card.fact.key, card.fact.params));
  return out;
}

export function AiOrMe({ round, weekHref, onPlayed, compact = false }: { round: AiOrMeRoundFull; weekHref: string | null; onPlayed?: (completed: NonNullable<AiOrMeRoundFull['completed']>) => void; compact?: boolean }) {
  const { t } = useT();
  const [completed, setCompleted] = useState(round.completed ?? null);
  useEffect(() => setCompleted(round.completed ?? null), [round.roundId, round.completed]);

  return (
    <section className={sa.section} data-compact={compact || undefined} aria-labelledby="aiorme-title">
      <div className={sa.head}>
        <h2 id="aiorme-title" className={sa.title}>
          {t('today.aiOrMe.title')}
        </h2>
        {!completed ? <p className={sa.lead}>{t('today.aiOrMe.lead')}</p> : null}
      </div>
      {completed ? (
        <Played round={round} completed={completed} weekHref={weekHref} />
      ) : (
        <Game
          round={round}
          weekHref={weekHref}
          onDone={(c) => {
            setCompleted(c);
            onPlayed?.(c);
          }}
        />
      )}
    </section>
  );
}

function Game({ round, onDone }: { round: AiOrMeRoundFull; weekHref: string | null; onDone: (c: NonNullable<AiOrMeRoundFull['completed']>) => void }) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const cards = round.cards;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(Answer | null)[]>(() => cards.map(() => null));
  const [phase, setPhase] = useState<'ask' | 'flipped' | 'exit'>('ask');
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'busy' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; w: number } | null>(null);
  // a mouse drag ends with a click on the same card; that click must not skip the reveal it started
  const dragged = useRef(false);
  const answeredAt = useRef(0);
  // an answer given while the previous card is still sliding away waits for the next card
  const queued = useRef<Answer | null>(null);
  const timers = useRef<number[]>([]);
  // points fly from the game itself (the result line replaces the stack when the last card leaves)
  const resultRef = useRef<HTMLDivElement>(null);
  const finished = i >= cards.length;

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const save = useCallback(
    async (all: (Answer | null)[]) => {
      setSaving('busy');
      setSaveError(null);
      try {
        const r = await submitAiOrMe(round.roundId, all);
        applyAwards(r.pointsAwarded, resultRef.current);
        setSaving('idle');
        onDone({ correct: r.correct, right: r.right, total: r.total });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'already_played') {
          const c = (err.body as { completed?: NonNullable<AiOrMeRoundFull['completed']> } | null)?.completed;
          if (c) return onDone(c);
        }
        setSaving('error');
        setSaveError(t(errorKey(errorCode(err))));
      }
    },
    [round.roundId, applyAwards, onDone, t],
  );

  const next = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    const go = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
      setPhase('ask');
      setDx(0);
      setI((n) => n + 1);
    };
    if (reducedMotion()) return go();
    setPhase('exit');
    timers.current.push(window.setTimeout(go, EXIT_MS));
  }, []);

  const answer = useCallback(
    (a: Answer) => {
      if (finished) return;
      if (phase === 'flipped') {
        // a later press skips the wait; a double click does not swallow the fact
        if (performance.now() - answeredAt.current > MIN_READ_MS) next();
        return;
      }
      if (phase === 'exit') {
        queued.current = a;
        return;
      }
      const card = cards[i];
      const all = answers.map((x, k) => (k === i ? a : x));
      setAnswers(all);
      answeredAt.current = performance.now();
      setPhase('flipped');
      setDx(0);
      sound.play(card.answer === a ? 'found' : 'tap');
      timers.current.push(window.setTimeout(next, REVEAL_MS + FLIP_MS));
      if (i === cards.length - 1) void save(all);
    },
    [finished, phase, cards, i, answers, next, save],
  );

  // the next card is ready: play the answer that came in while the last one was leaving
  useEffect(() => {
    if (phase !== 'ask' || !queued.current) return;
    const a = queued.current;
    queued.current = null;
    answer(a);
  }, [phase, i, answer]);

  // ← AI, → human, for as long as the game is on the page
  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable], [role="radiogroup"], [role="group"][tabindex]') || el.isContentEditable)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        answer('ai');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        answer('human');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, finished]);

  /* ---------- swipe ---------- */
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (phase !== 'ask' || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, w: e.currentTarget.getBoundingClientRect().width };
    setDragging(true);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setDx(e.clientX - d.x);
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const moved = e.clientX - d.x;
    dragged.current = Math.abs(moved) > 6;
    if (Math.abs(moved) >= SWIPE_AT * d.w) answer(moved < 0 ? 'ai' : 'human');
    else setDx(0);
  };

  if (finished) {
    const correct = cards.map((c, k) => answers[k] === c.answer);
    const right = cards.reduce((n, c, k) => n + (c.counted && correct[k] ? 1 : 0), 0);
    const total = cards.filter((c) => c.counted).length;
    return (
      <div className={sa.result} ref={resultRef}>
        <p className={sa.big}>{t('today.aiOrMe.result', { right, total })}</p>
        {saving === 'error' ? (
          <div className={sa.saveErr} role="alert">
            <p>{saveError}</p>
            <Button size="sm" variant="secondary" onClick={() => save(answers)}>
              {t('today.aiOrMe.saveAgain')}
            </Button>
          </div>
        ) : (
          <p className={sa.status} role="status">
            {saving === 'busy' ? t('today.aiOrMe.saving') : null}
          </p>
        )}
      </div>
    );
  }

  const top = cards[i];
  const own = answers[i];
  const tilt = Math.max(-14, Math.min(14, dx / 14));
  const lean = Math.min(1, Math.abs(dx) / 120);
  const exitDir = own === 'ai' ? -1 : 1;

  return (
    <div className={sa.game} ref={resultRef}>
      <div className={sa.stack}>
        {cards.slice(i, i + 3).map((card, k) => {
          const isTop = k === 0;
          const style: CSSProperties = isTop
            ? {
                transform:
                  phase === 'exit'
                    ? `translateX(${exitDir * 130}%) rotate(${exitDir * 16}deg)`
                    : `translateX(${dx}px) rotate(${tilt}deg)`,
                transition: dragging ? 'none' : undefined,
                opacity: phase === 'exit' ? 0 : 1,
              }
            : { transform: `translateY(${k * 14}px) scale(${1 - k * 0.05})`, zIndex: 3 - k };
          return (
            <div
              key={card.taskId}
              className={sa.card}
              data-top={isTop || undefined}
              data-phase={isTop ? phase : undefined}
              style={style}
              onPointerDown={isTop ? onDown : undefined}
              onPointerMove={isTop ? onMove : undefined}
              onPointerUp={isTop ? onUp : undefined}
              onPointerCancel={
                isTop
                  ? () => {
                      drag.current = null;
                      setDragging(false);
                      setDx(0);
                    }
                  : undefined
              }
              onClick={
                isTop && phase === 'flipped'
                  ? () => {
                      if (dragged.current) dragged.current = false;
                      else if (performance.now() - answeredAt.current > MIN_READ_MS) next();
                    }
                  : undefined
              }
              aria-hidden={!isTop || undefined}
            >
              <div className={sa.inner} data-flipped={(isTop && phase !== 'ask') || undefined}>
                <div className={sa.front}>
                  {isTop ? (
                    <>
                      <span className={sa.lean} data-side="ai" style={{ opacity: dx < 0 ? lean : 0 }} aria-hidden="true">
                        <i />
                        {t('today.aiOrMe.ai')}
                      </span>
                      <span className={sa.lean} data-side="human" style={{ opacity: dx > 0 ? lean : 0 }} aria-hidden="true">
                        <i />
                        {t('today.aiOrMe.human')}
                      </span>
                    </>
                  ) : null}
                  <span className={sa.n}>{t('today.aiOrMe.card', { n: i + k + 1, total: cards.length })}</span>
                  <p className={sa.task}>{card.text}</p>
                </div>
                {isTop ? (
                  <div className={sa.back} data-answer={card.answer} data-counted={card.counted || undefined} aria-hidden={phase === 'ask' || undefined}>
                    <span className={sa.band} aria-hidden="true" />
                    <p className={sa.verdict}>
                      {!card.counted ? t('today.aiOrMe.notScored') : own === card.answer ? t('today.aiOrMe.right') : t('today.aiOrMe.wrong')}
                    </p>
                    <p className={sa.answerIs}>{card.answer === 'ai' ? t('today.aiOrMe.ai') : t('today.aiOrMe.human')}</p>
                    <div className={sa.facts}>
                      {factLines(t, card).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {phase !== 'ask' && top
          ? `${!top.counted ? t('today.aiOrMe.notScored') : own === top.answer ? t('today.aiOrMe.right') : t('today.aiOrMe.wrong')}. ${factLines(t, top).join(' ')}`
          : ''}
      </p>
      <div className={sa.buttons}>
        <button type="button" className={sa.choice} data-side="ai" onClick={() => answer('ai')} aria-keyshortcuts="ArrowLeft">
          <kbd aria-hidden="true">←</kbd>
          <i className={sa.swatch} aria-hidden="true" />
          <span>{t('today.aiOrMe.ai')}</span>
        </button>
        <button type="button" className={sa.choice} data-side="human" onClick={() => answer('human')} aria-keyshortcuts="ArrowRight">
          <i className={sa.swatch} aria-hidden="true" />
          <span>{t('today.aiOrMe.human')}</span>
          <kbd aria-hidden="true">→</kbd>
        </button>
      </div>
    </div>
  );
}

function Played({ round, completed, weekHref }: { round: AiOrMeRoundFull; completed: NonNullable<AiOrMeRoundFull['completed']>; weekHref: string | null }) {
  const { t } = useT();
  const { right, total } = completed;
  const line = total > 0 && right === total ? t('today.aiOrMe.perfect') : right * 2 >= total ? t('today.aiOrMe.good') : t('today.aiOrMe.learn');
  return (
    <div className={sa.played}>
      <div className={sa.playedHead}>
        <p className={sa.big}>{t('today.aiOrMe.result', { right, total })}</p>
        <p className={sa.playedLine}>{line}</p>
      </div>
      <ol className={sa.rows}>
        {round.cards.map((c, k) => {
          const ok = completed.correct[k];
          return (
            <li key={c.taskId} className={sa.row}>
              <span className={sa.rowTile} data-answer={c.answer} aria-hidden="true" />
              <span className={sa.rowText}>
                <span className={sa.rowTask}>{c.text}</span>
                <span className={sa.rowAnswer}>{c.answer === 'ai' ? t('today.aiOrMe.ai') : t('today.aiOrMe.human')}</span>
              </span>
              <span className={sa.rowMark} data-ok={c.counted ? ok : undefined}>
                {!c.counted ? (
                  <span className={sa.rowNs}>{t('today.aiOrMe.notScoredShort')}</span>
                ) : ok ? (
                  <>
                    <Check size={18} strokeWidth={2.2} aria-hidden="true" />
                    <span className="sr-only">{t('today.aiOrMe.right')}</span>
                  </>
                ) : (
                  <>
                    <X size={18} strokeWidth={2.2} aria-hidden="true" />
                    <span className="sr-only">{t('today.aiOrMe.wrong')}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <div className={sa.playedFoot}>
        {weekHref ? (
          <Link href={weekHref} className={sa.link}>
            {t('today.aiOrMe.weekLink')}
          </Link>
        ) : null}
        <span className={sa.tomorrow}>{t('today.aiOrMe.tomorrow')}</span>
      </div>
    </div>
  );
}
