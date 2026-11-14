'use client';

import { SendHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { locateLoose, quoteIn, type RepView } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { answerRep, errorCode, errorKey, harmOf, repFromConflict } from './api';
import { AutoText } from './DelegateRep';
import { useKeyboardInset } from './hooks';
import { Outcome, RepHeader, Ring } from './shared';
import type { RepProps } from './SlipRep';
import st from './today.module.css';
import se from './edge.module.css';

const MAX_REPLIES = 6;
const FINISH_AFTER = 2;
const MSG_MAX = 600;
const NOT_NAMES = new Set(['a', 'an', 'the', 'your', 'our', 'this', 'one', 'their', 'his', 'her']);

/** The person's initial for the warm circle: the first word when it is a name, else the first letter. */
export function personaInitial(personaPublic: string): string {
  const first = personaPublic.trim().split(/[\s,.:;—-]+/)[0] ?? '';
  const letter = (s: string) => (s.match(/\p{L}/u)?.[0] ?? '').toUpperCase();
  if (first && /^\p{Lu}/u.test(first) && !NOT_NAMES.has(first.toLowerCase())) return letter(first);
  return letter(personaPublic) || '·';
}

type Pending = { text: string; failed: boolean } | null;

export function EdgeRep({ rep, streak, fresh, isFree, onAnswered, onBack, onPractice }: RepProps) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const e = rep.edge!;
  const done = rep.status === 'done' && !!rep.result;
  const used = e.turns.filter((x) => x.role === 'user').length;
  const left = done ? 0 : e.repliesLeft;

  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inset = useKeyboardInset(focused && !done);
  const logRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const finishRef = useRef<HTMLButtonElement>(null);

  // keep the newest line in view as the conversation grows
  useEffect(() => {
    const el = logRef.current?.lastElementChild;
    if (el && !done) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [e.turns.length, pending, done]);

  const busy = !!pending && !pending.failed;

  const send = async (text: string) => {
    const msg = text.trim().slice(0, MSG_MAX);
    if (!msg || busy || finishing) return;
    setPending({ text: msg, failed: false });
    setDraft('');
    setError(null);
    try {
      const r = await answerRep(rep.id, { message: msg });
      setPending(null);
      if (r.rep.status === 'done') applyAwards(r.pointsAwarded, sendRef.current);
      onAnswered(r);
    } catch (err) {
      const prior = repFromConflict(err);
      if (prior && 'rep' in prior) {
        setPending(null);
        return onAnswered({ rep: prior.rep, pointsAwarded: [], streak: streak! });
      }
      setPending({ text: msg, failed: true });
      const code = errorCode(err);
      if (code !== 'network' && code !== 'ai_unavailable' && code !== 'server_error') setError(t(errorKey(code)));
    }
  };

  const finish = async () => {
    if (busy || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const r = await answerRep(rep.id, { finish: true });
      applyAwards(r.pointsAwarded, finishRef.current);
      onAnswered(r);
    } catch (err) {
      const prior = repFromConflict(err);
      if (prior && 'rep' in prior) return onAnswered({ rep: prior.rep, pointsAwarded: [], streak: streak! });
      setError(t(errorKey(errorCode(err))));
    } finally {
      setFinishing(false);
    }
  };

  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      void send(draft);
    }
  };

  /* ---------- grade: notes beside the replies they quote ---------- */
  const graded = useMemo(() => {
    if (!done) return null;
    const crit = e.criteria.map((c, i) => ({ ...c, n: i + 1, grade: rep.result?.criteria?.find((g) => g.id === c.id) }));
    const byTurn = new Map<number, typeof crit>();
    const loose: typeof crit = [];
    for (const c of crit) {
      const q = c.grade?.quote;
      const idx = q && c.grade?.status !== 'missed' ? e.turns.findIndex((x) => x.role === 'user' && quoteIn(x.text, q)) : -1;
      if (idx >= 0) byTurn.set(idx, [...(byTurn.get(idx) ?? []), c]);
      else loose.push(c);
    }
    // a reply that could do harm is named plainly on the reply itself
    const harms = harmOf(rep.result).map((h) => ({ ...h, turn: e.turns.findIndex((x) => x.role === 'user' && quoteIn(x.text, h.quote)) }));
    return { crit, byTurn, loose, harms };
  }, [done, e, rep.result]);

  const statusWord = { met: t('today.edge.met'), partly: t('today.edge.partly'), missed: t('today.edge.missed') } as const;
  const initial = personaInitial(e.personaPublic);

  const bubbleText = (text: string, idx: number): ReactNode => {
    const notes = graded?.byTurn.get(idx) ?? [];
    const harmHere = graded?.harms.filter((h) => h.turn === idx) ?? [];
    if (!notes.length && !harmHere.length) return text;
    type Span = { at: [number, number]; status: string; n?: number };
    const spans: Span[] = [
      // harm first, so it wins where it overlaps a quote
      ...harmHere.map((h) => ({ at: locateLoose(text, h.quote), status: 'harm' })),
      ...notes.map((c) => ({ at: c.grade?.quote ? locateLoose(text, c.grade.quote) : null, status: c.grade?.status ?? 'met', n: c.n })),
    ].filter((x): x is Span => !!x.at);
    const kept: Span[] = [];
    for (const s of spans) if (!kept.some((k) => s.at[0] < k.at[1] && s.at[1] > k.at[0])) kept.push(s);
    kept.sort((a, b) => a.at[0] - b.at[0]);
    const out: ReactNode[] = [];
    let pos = 0;
    for (const { at, status, n } of kept) {
      out.push(text.slice(pos, at[0]));
      out.push(
        <mark key={at[0]} className={se.q} data-status={status}>
          {text.slice(at[0], at[1])}
        </mark>,
      );
      if (n) out.push(<sup key={`n${at[0]}`} className={se.qn} aria-hidden="true">{n}</sup>);
      pos = at[1];
    }
    out.push(text.slice(pos));
    return out;
  };

  const harmNote = (h: { quote: string; why: string }, k: number) => (
    <div key={`h${k}`} className={se.harm} role="note">
      <b>{t('today.edge.harmTitle')}</b>
      <p>{h.why}</p>
    </div>
  );

  const note = (c: NonNullable<typeof graded>['crit'][number], i: number) => {
    const s = c.grade?.status ?? 'missed';
    return (
      <div key={c.id} className={se.note} data-status={s} style={{ animationDelay: `${fresh ? 300 + i * 90 : 0}ms` }}>
        <Ring n={c.n} state={s === 'met' ? 'found' : s === 'partly' ? 'partly' : 'missed'} />
        <div>
          {/* a landed move is told by the grader's own sentence; a missing one also names what was expected */}
          <b>{statusWord[s]}</b> {s === 'missed' || !c.grade?.note ? <span className={se.noteCrit}>{c.text}</span> : <span className="sr-only">{c.text}</span>}
          {c.grade?.note ? <p>{c.grade.note}</p> : null}
        </div>
      </div>
    );
  };

  const met = graded ? graded.crit.filter((c) => c.grade?.status === 'met').length : 0;
  const tally = graded ? (
    <div className={se.tally}>
      <p className={se.tallyBig} aria-live="polite">
        {t('today.edge.tally', { met, total: graded.crit.length })}
      </p>
      <div className={se.tallyRings} aria-hidden="true">
        {graded.crit.map((c, i) => (
          <Ring key={c.id} n={c.n} state={c.grade?.status === 'met' ? 'found' : c.grade?.status === 'partly' ? 'partly' : 'missed'} delay={fresh ? 200 + i * 120 : 0} />
        ))}
      </div>
      {rep.result?.flags?.includes('ended_early') ? <p className={se.flag}>{t('today.edge.flagEnded')}</p> : null}
      {rep.result?.flags?.includes('keyword_grade') ? <p className={se.flag}>{t('today.edge.flagKeywords')}</p> : null}
    </div>
  ) : null;

  const sheet = (
    <article className={se.sheet} data-done={done || undefined} aria-labelledby="edge-title">
      <h2 id="edge-title" className="sr-only">
        {rep.title}
      </h2>
      <dl className={se.facts}>
        <div>
          <dt>{t('today.edge.situation')}</dt>
          <dd>{e.scenario}</dd>
        </div>
        <div>
          <dt>{t('today.edge.who')}</dt>
          <dd className={se.who}>
            <span className={se.initial} aria-hidden="true">
              {initial}
            </span>
            <span>{e.personaPublic}</span>
          </dd>
        </div>
        <div>
          <dt>{t('today.edge.goal')}</dt>
          <dd>{e.goal}</dd>
        </div>
      </dl>

      <div className={se.talk} ref={logRef} role="log" aria-live="polite" aria-label={t('today.edge.log')}>
        {e.turns.map((turn, i) => (
          <div key={i} className={se.row} data-role={turn.role}>
            {turn.role === 'persona' ? (
              <span className={se.avatar} aria-hidden="true">
                {initial}
              </span>
            ) : null}
            <p className={se.bubble} data-role={turn.role}>
              <span className="sr-only">{turn.role === 'persona' ? t('today.edge.them') : t('today.edge.you')}: </span>
              {turn.role === 'user' ? bubbleText(turn.text, i) : turn.text}
            </p>
            {graded?.byTurn.get(i)?.length || graded?.harms.some((h) => h.turn === i) ? (
              <div className={se.margin}>
                {graded.harms.filter((h) => h.turn === i).map(harmNote)}
                {(graded.byTurn.get(i) ?? []).map((c, k) => note(c, k))}
              </div>
            ) : null}
          </div>
        ))}
        {pending ? (
          <div className={se.row} data-role="user">
            <p className={se.bubble} data-role="user" data-pending={!pending.failed || undefined} data-failed={pending.failed || undefined}>
              {pending.text}
            </p>
            {pending.failed ? (
              <p className={se.failed} role="alert">
                {t('today.edge.notHeard')}
                <button type="button" className={se.resend} onClick={() => send(pending.text)}>
                  {t('today.edge.sendAgain')}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        {busy ? (
          <div className={se.row} data-role="persona">
            <span className={se.avatar} aria-hidden="true">
              {initial}
            </span>
            <p className={se.bubble} data-role="persona" data-typing>
              <span className="sr-only">{t('today.edge.typing')}</span>
              <span className={st.dots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {done && graded ? (
        <div className={se.after}>
          {graded.harms.filter((h) => h.turn < 0).map((h, k) => (
            <div key={k} className={se.harmLoose}>
              <q>{h.quote}</q>
              {harmNote(h, k)}
            </div>
          ))}
          {graded.loose.length ? (
            <div className={se.loose}>
              <h3 className={se.looseTitle}>{t('today.edge.notInTalk')}</h3>
              {graded.loose.map((c, i) => note(c, i))}
            </div>
          ) : null}
          {rep.reveal?.personaHidden ? (
            <div className={se.hidden}>
              <span className={se.initial} aria-hidden="true">
                {initial}
              </span>
              <div>
                <h3 className={se.hiddenTitle}>{t('today.edge.hidden')}</h3>
                <p>{rep.reveal.personaHidden}</p>
              </div>
            </div>
          ) : null}
          {rep.result?.summary ? <p className={se.summary}>{rep.result.summary}</p> : null}
        </div>
      ) : (
        <div className={se.composer} data-kb={inset > 0 || undefined} style={inset > 0 ? { bottom: inset } : undefined}>
          {error ? (
            <p className={st.inlineError} role="alert">
              {error}
            </p>
          ) : null}
          <label htmlFor="reply" className="sr-only">
            {t('today.edge.field')}
          </label>
          <div className={se.inputRow}>
            <AutoText
              id="reply"
              className={se.input}
              value={draft}
              onChange={(v) => setDraft(v.slice(0, MSG_MAX))}
              minRows={1}
              maxRows={6}
              maxLength={MSG_MAX}
              placeholder={left > 0 ? t('today.edge.placeholder') : t('today.edge.noneLeft')}
              disabled={left <= 0 || finishing}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-describedby="reply-keys"
              enterKeyHint="send"
            />
            <Button ref={sendRef} className={se.send} disabledReason={undefined} disabled={!draft.trim() || busy || left <= 0} aria-label={t('today.edge.send')} onClick={() => send(draft)} icon={<SendHorizontal strokeWidth={1.9} />}>
              <span className={se.sendWord}>{t('today.edge.send')}</span>
            </Button>
          </div>
          <div className={se.composeFoot}>
            <span className={se.counter}>{t('today.edge.replies', { used, max: MAX_REPLIES })}</span>
            <span id="reply-keys" className={se.keys}>
              {t('today.edge.keys')}
            </span>
            {used >= FINISH_AFTER ? (
              <Button ref={finishRef} size="sm" variant="secondary" loading={finishing} loadingLabel={t('today.edge.finishing')} disabled={busy} onClick={finish}>
                {t('today.edge.finish')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );

  return (
    <div className={st.repPage}>
      <RepHeader rep={rep} ask={done ? t('today.edge.askDone') : t('today.edge.ask', { max: MAX_REPLIES, after: FINISH_AFTER })} onBack={onBack} />
      <div className={se.grid} data-done={done || undefined}>
        <div className={se.main}>{sheet}</div>
        {done && tally ? (
          <div className={se.side}>
            <Outcome rep={rep} streak={streak} fresh={fresh} isFree={isFree} onPractice={onPractice} tally={tally} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
