'use client';

import { ChevronDown, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Button } from '@/components/kit/Button';
import { RepCard } from '@/components/kit/RepCard';
import { Skeleton } from '@/components/kit/Skeleton';
import type { CharRange, ReviewMark } from '@/components/kit/types';
import { locateLoose, type RepView } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { answerRep, caughtByAiOf, errorCode, errorKey, exemplarOf, repFromConflict, reviewOf } from './api';
import { DocText, type Spot } from './DocText';
import { Outcome, RepHeader, Ring } from './shared';
import type { RepProps } from './SlipRep';
import st from './today.module.css';
import sd from './delegate.module.css';

const MIN = 30;
const MAX = 1200;
const FIX_MAX = 400;
const draftKey = (id: string) => `irr:delegate:${id}`;

function readText(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeText(key: string, v: string) {
  try {
    if (v) window.localStorage.setItem(key, v);
    else window.localStorage.removeItem(key);
  } catch {
    /* kept in the page only */
  }
}

/** Textarea that grows with its text up to `maxRows`. */
export function AutoText({ value, onChange, maxRows = 12, minRows = 3, className, ...rest }: { value: string; onChange: (v: string) => void; maxRows?: number; minRows?: number; className?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 26;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, line * minRows + pad), line * maxRows + pad);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > h + 1 ? 'auto' : 'hidden';
  }, [value, maxRows, minRows]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} className={className} rows={minRows} {...rest} />;
}

/** A finished step folded into one line; it opens again to be read. */
function Folded({ n, title, excerpt, children }: { n?: number; title: string; excerpt?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={sd.folded} data-open={open || undefined}>
      <button type="button" className={sd.foldBtn} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={sd.stepN} data-icon={n === undefined || undefined} aria-hidden="true">
          {n ?? <FolderOpen size={15} strokeWidth={2} />}
        </span>
        <span className={sd.foldTitle}>{title}</span>
        {excerpt && !open ? <span className={sd.foldExcerpt}>{excerpt}</span> : <span className={sd.foldSpacer} />}
        <ChevronDown size={18} strokeWidth={2} className={sd.foldChev} aria-hidden="true" />
      </button>
      {open ? <div className={sd.foldBody}>{children}</div> : null}
    </div>
  );
}

export function DelegateRep({ rep, streak, fresh, isFree, onAnswered, onBack, onPractice }: RepProps) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const d = rep.delegate!;
  const done = rep.status === 'done' && !!rep.result;
  const ran = d.run !== undefined;
  const step = done ? 3 : ran ? 2 : 1;

  const [instruction, setInstruction] = useState(d.instruction ?? '');
  const [fix, setFix] = useState('');
  const [ranges, setRanges] = useState<CharRange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step !== 1) return;
    const saved = readText(draftKey(rep.id));
    if (saved && !d.instruction) setInstruction(saved);
  }, [rep.id, step, d.instruction]);
  useEffect(() => {
    if (step === 1) writeText(draftKey(rep.id), instruction);
  }, [rep.id, step, instruction]);

  const len = instruction.trim().length;
  const run = async () => {
    if (len < MIN || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await answerRep(rep.id, { step: 'instruction', instruction: instruction.trim() });
      writeText(draftKey(rep.id), '');
      applyAwards(r.pointsAwarded, runRef.current);
      onAnswered(r);
    } catch (err) {
      const prior = repFromConflict(err);
      if (prior && 'rep' in prior) return onAnswered({ rep: prior.rep, pointsAwarded: [], streak: streak! });
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(false);
    }
  };
  const review = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await answerRep(rep.id, { step: 'review', ranges, fix: fix.trim().slice(0, FIX_MAX) });
      applyAwards(r.pointsAwarded, checkRef.current);
      onAnswered(r);
    } catch (err) {
      const prior = repFromConflict(err);
      if (prior && 'rep' in prior) return onAnswered({ rep: prior.rep, pointsAwarded: [], streak: streak! });
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(false);
    }
  };

  const caseSheet = (spots: Spot[] = []) => (
    <article className={sd.case} aria-labelledby="case-title">
      <h2 id="case-title" className={sd.caseTitle}>
        {rep.title}
      </h2>
      <dl className={sd.caseFacts}>
        <div>
          <dt>{t('today.delegate.situation')}</dt>
          <dd>{d.scenario}</dd>
        </div>
        <div>
          <dt>{t('today.delegate.goal')}</dt>
          <dd>{d.goal}</dd>
        </div>
      </dl>
      <div className={sd.material}>
        <h3 className={sd.materialTitle}>{t('today.delegate.material')}</h3>
        <DocText src={d.inputs} spots={spots} />
      </div>
    </article>
  );

  const errorLine = error ? (
    <p className={st.inlineError} role="alert">
      {error}
    </p>
  ) : null;

  /* ---------- step 1: write the instructions ---------- */
  if (step === 1) {
    return (
      <div className={st.repPage}>
        <RepHeader rep={rep} ask={t('today.delegate.ask')} onBack={onBack} />
        <div className={sd.grid}>
          <div className={sd.main}>{caseSheet()}</div>
          <div className={sd.side}>
            {busy ? (
              <Running />
            ) : (
              <section className={sd.note} aria-labelledby="instr-label">
                <div className={sd.to}>
                  <span className={sd.machineTag} aria-hidden="true" />
                  {t('today.delegate.to')}
                </div>
                <label id="instr-label" htmlFor="instr" className={sd.noteLabel}>
                  {t('today.delegate.field')}
                </label>
                <AutoText
                  id="instr"
                  className={sd.area}
                  value={instruction}
                  onChange={(v) => setInstruction(v.slice(0, MAX))}
                  minRows={7}
                  maxRows={16}
                  maxLength={MAX}
                  placeholder={t('today.delegate.placeholder')}
                  aria-describedby="instr-hint instr-count"
                />
                <div className={sd.noteFoot}>
                  <p id="instr-hint" className={sd.hint}>
                    {t('today.delegate.hint')}
                  </p>
                  <span id="instr-count" className={sd.counter} data-low={len > 0 && len < MIN ? true : undefined}>
                    {t('today.delegate.count', { n: instruction.length, max: MAX })}
                  </span>
                </div>
                {errorLine}
                <Button ref={runRef} size="lg" block disabledReason={len < MIN ? t('today.delegate.min', { min: MIN }) : undefined} onClick={run}>
                  {d.instruction && !ran ? t('today.delegate.runAgain') : t('today.delegate.run')}
                </Button>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- step 2: review what the AI wrote ---------- */
  if (step === 2) {
    return (
      <div className={st.repPage}>
        <RepHeader rep={rep} ask={t('today.delegate.ask')} onBack={onBack} />
        <div className={sd.foldedRow}>
          <Folded n={1} title={t('today.delegate.step1')} excerpt={d.instruction}>
            <div className={sd.instrRead}>
              <DocText src={d.instruction ?? ''} plain />
            </div>
          </Folded>
          <Folded title={t('today.delegate.caseLine')}>
            {caseSheet()}
          </Folded>
        </div>
        <div className={sd.grid}>
          <div className={sd.main}>
            <h2 className={sd.stepTitle}>
              <span className={sd.stepN} aria-hidden="true">
                2
              </span>
              {t('today.delegate.step2')}
            </h2>
            <p className={sd.stepAsk}>{t('today.delegate.reviewAsk')}</p>
            <RepCard document={d.run ?? ''} mode="answer" ranges={ranges} onRangesChange={setRanges} stack={false} ariaLabel={t('today.delegate.step2')} />
          </div>
          <div className={sd.side}>
            <section className={sd.reviewBox} aria-labelledby="fix-label">
              <p className={sd.marked}>{ranges.length ? t('today.delegate.marked', { count: ranges.length }) : t('today.delegate.markedNone')}</p>
              <label id="fix-label" htmlFor="fix" className={sd.noteLabel}>
                {t('today.delegate.fixLabel')}
              </label>
              <AutoText id="fix" className={sd.area} value={fix} onChange={(v) => setFix(v.slice(0, FIX_MAX))} minRows={3} maxRows={6} maxLength={FIX_MAX} placeholder={t('today.delegate.fixHint')} />
              {errorLine}
              <Button ref={checkRef} size="lg" block loading={busy} loadingLabel={t('today.delegate.checking')} onClick={review}>
                {t('today.delegate.check')}
              </Button>
            </section>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- step 3: the grade ---------- */
  return <DelegateGrade rep={rep} streak={streak} fresh={fresh} isFree={isFree} onBack={onBack} onPractice={onPractice} caseSheet={caseSheet} myFix={fix.trim()} />;
}

function Running() {
  const { t } = useT();
  return (
    <div className={sd.running} role="status">
      <p className={sd.runningText}>
        {t('today.delegate.running')}
        <span className={st.dots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
      <div className={sd.runningSheet} aria-hidden="true">
        <Skeleton width="58%" height={20} />
        {[92, 84, 96, 70, 88, 62].map((w, i) => (
          <Skeleton key={i} width={`${w}%`} height={12} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}

function DelegateGrade({
  rep,
  streak,
  fresh,
  isFree,
  onBack,
  onPractice,
  caseSheet,
  myFix,
}: Omit<RepProps, 'onAnswered'> & { caseSheet: (spots?: Spot[]) => ReactNode; /** The fix sentence sent in this tab (the API does not return it). */ myFix: string }) {
  const { t } = useT();
  const d = rep.delegate!;
  const r = rep.result!;
  const instruction = d.instruction ?? '';
  const traps = rep.reveal?.traps ?? [];
  const caught = new Set(r.trapsCaught ?? []);
  // a trap the AI flagged by itself was not the person's catch, and not a miss either
  const byAi = caughtByAiOf(rep);
  const trapState = (id: string): 'caught' | 'byAi' | 'missed' => (caught.has(id) ? 'caught' : byAi.has(id) ? 'byAi' : 'missed');
  const trapWord = { caught: t('today.delegate.trapCaught'), byAi: t('today.delegate.trapByAi'), missed: t('today.delegate.trapMissed') } as const;
  const spots = rep.reveal?.trapSpots ?? [];
  const fixSent = myFix || reviewOf(d)?.fix || '';
  const flags = r.flags ?? [];
  const criteria = d.criteria.map((c, i) => ({ ...c, n: i + 1, grade: r.criteria?.find((g) => g.id === c.id) }));
  const met = criteria.filter((c) => c.grade?.status === 'met').length;

  // quotes of the grader, found in the person's own words
  const quoteSpots = useMemo<Spot[]>(() => {
    const out: Spot[] = [];
    for (const c of criteria) {
      const q = c.grade?.quote;
      if (!q || c.grade?.status === 'missed') continue;
      const at = locateLoose(instruction, q);
      if (at && !out.some((s) => s.start < at[1] && s.end > at[0])) out.push({ start: at[0], end: at[1], kind: 'quote', n: c.n });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instruction, r.criteria]);

  const trapN = new Map(traps.map((tr, i) => [tr.id, i + 1]));
  const inputSpots: Spot[] = spots
    .filter((s) => s.where === 'inputs')
    .map((s) => ({ start: s.start, end: s.end, kind: trapState(s.trapId), n: trapN.get(s.trapId) }));
  const runMarks: ReviewMark[] = spots
    .filter((s) => s.where === 'run')
    .map((s, i) => ({
      id: `t${i}`,
      kind: trapState(s.trapId) === 'caught' ? 'found' : trapState(s.trapId) === 'byAi' ? 'false' : 'missed',
      start: s.start,
      end: s.end,
      n: trapN.get(s.trapId),
      title: trapWord[trapState(s.trapId)],
      body: traps.find((x) => x.id === s.trapId)?.description,
    }));

  const statusWord = { met: t('today.delegate.met'), partly: t('today.delegate.partly'), missed: t('today.delegate.missed') } as const;
  const tally = (
    <div className={sd.tally}>
      <p className={sd.tallyBig} aria-live="polite">
        {t('today.delegate.tally', { met, total: criteria.length })}
      </p>
      <div className={sd.tallyRings} aria-hidden="true">
        {criteria.map((c, i) => (
          <Ring key={c.id} n={c.n} state={c.grade?.status === 'met' ? 'found' : c.grade?.status === 'partly' ? 'partly' : 'missed'} delay={fresh ? 200 + i * 120 : 0} />
        ))}
      </div>
      {traps.length ? <p className={sd.tallyTraps}>{t('today.delegate.traps', { caught: caught.size, total: traps.length })}</p> : null}
      {flags.includes('ended_early') ? <p className={sd.flag}>{t('today.delegate.flagEnded')}</p> : null}
      {flags.includes('keyword_grade') ? <p className={sd.flag}>{t('today.delegate.flagKeywords')}</p> : null}
    </div>
  );

  return (
    <div className={st.repPage}>
      <RepHeader rep={rep} ask={t('today.delegate.askDone')} onBack={onBack} />
      <div className={sd.grid} data-done>
        <div className={sd.main}>
          <section aria-labelledby="crit-title" className={sd.block}>
            <h2 id="crit-title" className={sd.stepTitle}>
              <span className={sd.stepN} aria-hidden="true">
                3
              </span>
              {t('today.delegate.step3')}
            </h2>
            <div className={sd.instrSheet}>
              <div className={sd.to}>
                <span className={sd.machineTag} aria-hidden="true" />
                {t('today.delegate.yourInstr')}
              </div>
              <DocText src={instruction} spots={quoteSpots} plain />
            </div>
            <ol className={sd.criteria}>
              {criteria.map((c) => {
                const s = c.grade?.status ?? 'missed';
                return (
                  <li key={c.id} className={sd.crit} data-status={s}>
                    <Ring n={c.n} state={s === 'met' ? 'found' : s === 'partly' ? 'partly' : 'missed'} />
                    <div>
                      <p className={sd.critText}>
                        <b className={sd.critStatus}>{statusWord[s]}</b> {c.text}
                      </p>
                      {c.grade?.note ? <p className={sd.critNote}>{c.grade.note}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <Strong rep={rep} />

          {traps.length ? (
            <section aria-labelledby="traps-title" className={sd.block}>
              <h2 id="traps-title" className={sd.blockTitle}>
                {t('today.delegate.trapsTitle')}
              </h2>
              <ol className={sd.traps}>
                {traps.map((tr, i) => {
                  const s = trapState(tr.id);
                  return (
                    <li key={tr.id} className={sd.trap} data-state={s}>
                      <Ring n={i + 1} state={s === 'caught' ? 'found' : s === 'byAi' ? 'empty' : 'missed'} />
                      <p>
                        <b>{trapWord[s]}</b> {tr.description}
                      </p>
                    </li>
                  );
                })}
              </ol>
              {caseSheet(inputSpots)}
            </section>
          ) : null}

          {d.run ? (
            <section aria-labelledby="run-title" className={sd.block}>
              <h2 id="run-title" className={sd.blockTitle}>
                {t('today.delegate.step2')}
              </h2>
              {r.fixFeedback || fixSent ? (
                <div className={sd.fixFb}>
                  {fixSent ? (
                    <p>
                      <b>{t('today.delegate.yourFix')}</b> {fixSent}
                    </p>
                  ) : null}
                  {r.fixFeedback ? <p>{r.fixFeedback}</p> : null}
                </div>
              ) : null}
              <RepCard document={d.run} mode="review" ranges={[]} marks={runMarks} stack={false} ariaLabel={t('today.delegate.step2')} />
            </section>
          ) : null}
        </div>
        <div className={sd.side}>
          <Outcome rep={rep} streak={streak} fresh={fresh} isFree={isFree} onPractice={onPractice} tally={tally} />
        </div>
      </div>
    </div>
  );
}

/**
 * «What a strong instruction looks like»: the engine's exemplar instruction for this case, with the
 * points of today's rubric it covers. Before the exemplar exists, one instruction is put together from
 * the case and the rubric by a template. Either way the traps stay out of it: a strong instruction asks
 * for the checks that catch them without knowing them in advance.
 */
function Strong({ rep }: { rep: RepView }) {
  const { t } = useT();
  const d = rep.delegate!;
  const r = rep.result!;
  const ex = exemplarOf(rep.reveal);
  const covers = ex?.covers ? d.criteria.filter((c) => ex.covers!.includes(c.id)) : d.criteria;
  return (
    <section aria-labelledby="strong-title" className={sd.block}>
      {r.summary ? (
        <div className={sd.missing}>
          <h2 className={sd.missingTitle}>{t('today.delegate.missingLine')}</h2>
          <p className={sd.missingLine}>{r.summary}</p>
        </div>
      ) : null}
      <h2 id="strong-title" className={sd.blockTitle}>
        {t('today.delegate.strongTitle')}
      </h2>
      <div className={sd.strong}>
        <div className={sd.to}>
          <span className={sd.machineTag} aria-hidden="true" />
          {t('today.delegate.to')}
        </div>
        {ex ? (
          <DocText src={ex.text} plain />
        ) : (
          <>
            <p>{rep.brief}</p>
            <p>{t('today.delegate.strongGoal', { goal: d.goal })}</p>
          </>
        )}
      </div>
      <div className={sd.covers}>
        <h3 className={sd.coversTitle}>{t('today.delegate.covers')}</h3>
        <ul>
          {covers.map((c) => (
            <li key={c.id}>{c.text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
