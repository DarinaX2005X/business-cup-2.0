'use client';

import { ChevronDown, Lightbulb, Timer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { RepCard } from '@/components/kit/RepCard';
import { sound } from '@/components/kit/sound';
import type { CharRange, ReviewMark } from '@/components/kit/types';
import { REP_POINTS } from '@/domain/points';
import { OVER_SELECTED, type RepView } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { answerRep, askSlipHint, errorCode, errorKey, repFromConflict, tooBroadOf, type AnswerResult, type Streak } from './api';
import { clock, reducedMotion, useElapsed, useLocalFlag, useMounted } from './hooks';
import { Outcome, RepHeader, Ring } from './shared';
import st from './today.module.css';
import ss from './slip.module.css';

/** More than this share highlighted scores zero (the engine's `over_selected`). */
const OVER = OVER_SELECTED;
const draftKey = (id: string) => `irr:slip:${id}`;

function readDraft(id: string): CharRange[] {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) ? (v.filter((r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite)) as CharRange[]) : [];
  } catch {
    return [];
  }
}

function writeDraft(id: string, ranges: CharRange[] | null) {
  try {
    if (ranges && ranges.length) window.localStorage.setItem(draftKey(id), JSON.stringify(ranges));
    else window.localStorage.removeItem(draftKey(id));
  } catch {
    /* the draft lives only in this page */
  }
}

export interface RepProps {
  rep: RepView;
  streak: Streak | null;
  fresh: boolean;
  isFree: boolean;
  onAnswered: (r: AnswerResult) => void;
  onBack: () => void;
  onPractice: () => void;
}

export function SlipRep({ rep, streak, fresh, isFree, onAnswered, onBack, onPractice }: RepProps) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const mounted = useMounted();
  const doc = rep.slip?.document ?? '';
  const total = rep.slip?.errorCount ?? 0;
  const done = rep.status === 'done' && !!rep.result;

  const [ranges, setRanges] = useState<CharRange[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (done) return;
    setRanges(readDraft(rep.id));
    setLoaded(true);
  }, [rep.id, done]);
  useEffect(() => {
    if (loaded && !done) writeDraft(rep.id, ranges);
  }, [loaded, done, rep.id, ranges]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOver, setConfirmOver] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const checkRef = useRef<HTMLButtonElement>(null);
  const barCheckRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const selected = ranges.reduce((n, r) => n + (r[1] - r[0]), 0);
  const over = doc.length > 0 && selected > OVER * doc.length;

  const [hideTimer, setHideTimer] = useLocalFlag('irr:today:hideTimer');
  const elapsed = useElapsed(!done);

  const ask = t('today.slip.ask', { count: total });

  /* ---------- hints: the paragraph of a mistake not found yet, 10 points each ---------- */

  const [hints, setHints] = useState<{ start: number; end: number }[]>(() => rep.slipHints ?? []);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintNote, setHintNote] = useState<string | null>(null);
  const hintsLeft = Math.max(0, total - hints.length);

  /** Brings the hinted paragraph into view on the sheet (its first word carries the offset). */
  const showSpot = (spot: { start: number; end: number }) => {
    const words = Array.from(document.querySelectorAll<HTMLElement>('[data-s]'));
    const first = words.find((w) => Number(w.dataset.s) >= spot.start && Number(w.dataset.s) < spot.end);
    first?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };

  const askHint = async () => {
    if (hintBusy || done) return;
    setHintBusy(true);
    setHintNote(null);
    try {
      const r = await askSlipHint(rep.id, ranges);
      if (!r.hint) setHintNote(t('today.slip.hint.none'));
      else {
        const spot = r.hint;
        setHints((hs) => [...hs, spot]);
        window.requestAnimationFrame(() => showSpot(spot));
      }
    } catch (err) {
      setHintNote(t(errorKey(errorCode(err))));
    } finally {
      setHintBusy(false);
    }
  };

  /** The start of a paragraph, plain: up to twelve words without the light markup. */
  const opening = (spot: { start: number; end: number }) => {
    const words = doc.slice(spot.start, spot.end).replace(/\*\*|__|\|/g, ' ').trim().split(/\s+/);
    return words.length > 12 ? `${words.slice(0, 12).join(' ')}…` : words.join(' ');
  };

  const hintBlock = (
    <div className={ss.hints}>
      {hints.length ? (
        <ol className={ss.hintList} aria-label={t('today.slip.hint.listLabel')}>
          {hints.map((h, i) => (
            <li key={`${h.start}-${i}`}>
              <button type="button" className={ss.hintItem} onClick={() => showSpot(h)}>
                <Lightbulb size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>
                  {t('today.slip.hint.look')} <q>{opening(h)}</q>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {hintsLeft > 0 ? (
        <Button size="sm" variant="secondary" icon={<Lightbulb />} loading={hintBusy} loadingLabel={t('today.slip.hint.loading')} onClick={() => void askHint()}>
          {hints.length ? t('today.slip.hint.another') : t('today.slip.hint.ask')}
        </Button>
      ) : null}
      <p className={ss.hintCost}>{hintNote ?? t('today.slip.hint.cost', { points: REP_POINTS.hint })}</p>
    </div>
  );

  const check = async (force = false) => {
    if (!ranges.length || busy) return;
    if (over && !force) {
      setConfirmOver(true);
      return;
    }
    setConfirmOver(false);
    setBusy(true);
    setError(null);
    const origin = (window.matchMedia('(max-width: 900px)').matches ? barCheckRef.current : checkRef.current) ?? checkRef.current;
    try {
      const r = await answerRep(rep.id, { ranges });
      writeDraft(rep.id, null);
      applyAwards(r.pointsAwarded, origin);
      onAnswered(r);
      // the result strip lands above the sheet: bring it into view where the count plays
      window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
    } catch (err) {
      const prior = repFromConflict(err);
      if (prior && 'rep' in prior) {
        onAnswered({ rep: prior.rep, pointsAwarded: [], streak: streak ?? { current: 0, best: 0, lastDay: null, days: [], freezes: 0 } });
        return;
      }
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- review marks ---------- */

  const marks = useMemo<ReviewMark[]>(() => {
    if (!done) return [];
    const errors = [...(rep.reveal?.errors ?? [])].sort((a, b) => a.start - b.start);
    const order = new Map((rep.reveal?.errors ?? []).map((e, i) => [e, i]));
    const found = rep.result?.errorsFound ?? [];
    const out: ReviewMark[] = errors.map((e, i) => {
      const hit = !!found[order.get(e) ?? i];
      const type = t(`today.slip.type.${e.type}`);
      return { id: `e${i}`, kind: hit ? 'found' : 'missed', start: e.start, end: e.end, n: i + 1, title: t(hit ? 'today.slip.mark.found' : 'today.slip.mark.missed', { type }), body: e.explanation };
    });
    // a highlight that covers far more than the mistake is its own note
    const broad = tooBroadOf(rep.result);
    broad.forEach(([a, b], i) => out.push({ id: `b${i}`, kind: 'false', start: a, end: b, title: t('today.slip.mark.tooBroad'), body: t('today.slip.mark.tooBroadBody') }));
    const overlapsBroad = ([a, b]: [number, number]) => broad.some(([c, d]) => a < d && b > c);
    (rep.result?.falseRanges ?? []).filter((r) => !overlapsBroad(r)).forEach(([a, b], i) => {
      out.push(
        i === 0
          ? { id: `x${i}`, kind: 'first_false', start: a, end: b, title: t('today.slip.mark.free'), body: t('today.slip.mark.freeBody') }
          : { id: `x${i}`, kind: 'false', start: a, end: b, title: t('today.slip.mark.false'), body: t('today.slip.mark.falseBody') },
      );
    });
    return out;
  }, [done, rep, t]);

  const errorsInDoc = useMemo(() => {
    if (!done) return [];
    const found = rep.result?.errorsFound ?? [];
    return (rep.reveal?.errors ?? []).map((e, i) => ({ e, hit: !!found[i] })).sort((a, b) => a.e.start - b.e.start);
  }, [done, rep]);

  /* ---------- side column ---------- */

  const timer =
    mounted && !done ? (
      <div className={ss.timer}>
        {!hideTimer ? (
          <span className={ss.time} aria-label={t('today.slip.timerLabel')}>
            <Timer size={16} strokeWidth={1.75} aria-hidden="true" />
            {clock(elapsed)}
          </span>
        ) : null}
        <button type="button" className={ss.timerToggle} onClick={() => setHideTimer(!hideTimer)}>
          {hideTimer ? t('today.slip.timerShow') : t('today.slip.timerHide')}
        </button>
      </div>
    ) : null;

  const overWarning = confirmOver ? (
    <div className={ss.over} role="alert">
      <p>{t('today.slip.over')}</p>
      <div className={ss.overBtns}>
        <Button size="sm" variant="secondary" onClick={() => setConfirmOver(false)}>
          {t('today.slip.keepEditing')}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => check(true)}>
          {t('today.slip.checkAnyway')}
        </Button>
      </div>
    </div>
  ) : null;

  const list = (
    <ol className={ss.marks} aria-label={t('today.slip.yourMarks')}>
      {ranges.map(([a, b], i) => (
        <li key={`${a}-${b}`} className={ss.markRow}>
          <Ring n={i + 1} state="mark" />
          <q className={ss.quote}>{doc.slice(a, b)}</q>
          <button
            type="button"
            className={ss.remove}
            aria-label={t('today.slip.remove', { n: i + 1 })}
            onClick={() => {
              setRanges((rs) => rs.filter((_, j) => j !== i));
              setConfirmOver(false);
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </li>
      ))}
    </ol>
  );

  const answerColumn = (
    <aside className={ss.tally} aria-label={t('today.slip.panel')}>
      <div className={ss.find}>
        <h2 className={ss.findTitle}>{t('today.slip.toFind', { count: total })}</h2>
        <div className={ss.rings} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <Ring key={i} state="empty" />
          ))}
        </div>
      </div>
      <div className={ss.listWrap}>
        <h3 className={ss.listTitle}>
          {t('today.slip.yourMarks')}
          {ranges.length ? <span className={ss.count}>{ranges.length}</span> : null}
        </h3>
        {ranges.length ? list : <p className={ss.empty}>{t('today.slip.marksEmpty')}</p>}
      </div>
      {hintBlock}
      {overWarning}
      {error ? (
        <p className={st.inlineError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={ss.foot}>
        {timer}
        <Button
          ref={checkRef}
          block
          size="lg"
          loading={busy}
          loadingLabel={t('today.slip.checking')}
          disabledReason={ranges.length ? undefined : t('today.slip.needOne')}
          onClick={() => check()}
        >
          {t('today.slip.check')}
        </Button>
      </div>
    </aside>
  );

  /* phones: the column becomes a panel at the bottom, the list opens above it */
  const bar = (
    <div className={ss.bar} data-open={listOpen || undefined}>
      {listOpen && ranges.length ? <div className={ss.barList}>{list}</div> : null}
      {listOpen || hints.length ? <div className={ss.barHints}>{hintBlock}</div> : null}
      {overWarning}
      {error ? (
        <p className={st.inlineError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={ss.barRow}>
        <button type="button" className={ss.barCount} onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
          <span className={ss.barN} aria-label={t('today.slip.barCount', { marked: ranges.length, total })}>
            {t('today.slip.barMarked', { count: ranges.length })}
          </span>
          <ChevronDown size={16} strokeWidth={2} className={ss.chev} aria-hidden="true" />
        </button>
        {mounted && !hideTimer ? <span className={ss.barTime}>{clock(elapsed)}</span> : null}
        <span className={ss.barRings} aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} data-on={i < ranges.length || undefined} />
          ))}
        </span>
        <Button ref={barCheckRef} size="sm" loading={busy} loadingLabel={t('today.slip.checking')} disabled={!ranges.length} onClick={() => check()}>
          {t('today.slip.check')}
        </Button>
      </div>
    </div>
  );

  return (
    <div className={st.repPage}>
      <RepHeader rep={rep} ask={ask} onBack={onBack} />
      <div className={ss.work} data-done={done || undefined}>
        <div className={ss.docCol}>
          <RepCard
            document={doc}
            mode={done ? 'review' : 'answer'}
            ranges={done ? (rep.result?.ranges ?? []) : ranges}
            onRangesChange={(r) => {
              setRanges(r);
              setConfirmOver(false);
            }}
            marks={marks}
            ariaLabel={rep.title}
          />
          {done ? <Corrections items={errorsInDoc} /> : null}
        </div>
        <div className={ss.side} ref={resultRef}>
          {done ? (
            <Outcome rep={rep} streak={streak} fresh={fresh} isFree={isFree} onPractice={onPractice} tally={<SlipTally rep={rep} fresh={fresh} />} layout="band" />
          ) : (
            answerColumn
          )}
        </div>
      </div>
      {!done ? bar : null}
    </div>
  );
}

/** «2 of 3 caught»: the rings fill one by one with a tick for every catch. */
function SlipTally({ rep, fresh }: { rep: RepView; fresh: boolean }) {
  const { t } = useT();
  const r = rep.result!;
  const total = r.total ?? 0;
  const foundTotal = r.found ?? 0;
  const order = useMemo(() => {
    const found = r.errorsFound ?? [];
    return (rep.reveal?.errors ?? []).map((e, i) => ({ start: e.start, hit: !!found[i] })).sort((a, b) => a.start - b.start);
  }, [rep, r]);
  const [shown, setShown] = useState(fresh ? 0 : foundTotal);
  useEffect(() => {
    if (!fresh || reducedMotion()) {
      setShown(foundTotal);
      return;
    }
    const timers: number[] = [];
    for (let i = 1; i <= foundTotal; i++) {
      timers.push(
        window.setTimeout(() => {
          setShown(i);
          // the sheet itself plays the first tick
          if (i > 1) sound.play('found');
        }, 280 + (i - 1) * 340),
      );
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [fresh, foundTotal]);

  let seen = 0;
  const flags = r.flags ?? [];
  const broadN = tooBroadOf(r).length;
  const falseN = Math.max(0, (r.falseFlags ?? 0) - (r.falseRanges ?? []).filter(([a, b]) => tooBroadOf(r).some(([c, d]) => a < d && b > c)).length);
  const missed = total - foundTotal;
  return (
    <div className={ss.result}>
      <p className={ss.big} aria-live="polite">
        <span className={ss.bigN}>{t('today.slip.caught', { found: shown, total })}</span>
      </p>
      <div className={ss.rings} data-big aria-hidden="true">
        {order.map((o, i) => {
          const lit = o.hit && ++seen <= shown;
          return <Ring key={i} n={i + 1} state={lit ? 'found' : o.hit ? 'empty' : shown >= foundTotal ? 'missed' : 'empty'} />;
        })}
      </div>
      <p className={ss.verdict}>
        {flags.includes('over_selected')
          ? t('today.slip.overSelected')
          : missed === 0
            ? t('today.slip.allCaught')
            : foundTotal === 0
              ? t('today.slip.noneCaught')
              : t('today.slip.someMissed', { count: missed })}
      </p>
      {broadN > 0 && !flags.includes('over_selected') ? <p className={ss.falseLine}>{t('today.slip.tooBroadLine', { count: broadN })}</p> : null}
      {falseN > 0 && !flags.includes('over_selected') ? <p className={ss.falseLine}>{falseN === 1 ? t('today.slip.falseFree') : t('today.slip.falseMore', { count: falseN })}</p> : null}
      {r.hintsUsed ? <p className={ss.falseLine}>{t('today.slip.hint.used', { count: r.hintsUsed })}</p> : null}
    </div>
  );
}

/** Each planted mistake as an editor's correction: the draft struck through, the better wording under it. */
function Corrections({ items }: { items: { e: NonNullable<NonNullable<RepView['reveal']>['errors']>[number]; hit: boolean }[] }) {
  const { t } = useT();
  if (!items.length) return null;
  return (
    <section className={ss.fixes} aria-labelledby="fixes-title">
      <h2 id="fixes-title" className={ss.fixesTitle}>
        {t('today.slip.fixesTitle')}
      </h2>
      <ol className={ss.fixList}>
        {items.map(({ e, hit }, i) => (
          <li key={e.start} className={ss.fix}>
            <Ring n={i + 1} state={hit ? 'found' : 'missed'} />
            <div className={ss.fixBody}>
              <span className={ss.fixType}>{t(`today.slip.typeTag.${e.type}`)}</span>
              <p className={ss.fixFrom}>
                <span className="sr-only">{t('today.slip.fixFrom')}: </span>
                <del>{e.quote}</del>
              </p>
              <p className={ss.fixTo}>
                <span className="sr-only">{t('today.slip.fixTo')}: </span>
                <ins>{e.fix}</ins>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
