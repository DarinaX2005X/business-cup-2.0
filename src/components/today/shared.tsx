'use client';

import { BriefcaseBusiness, ChevronLeft, FileCheck2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { ScoreDial } from '@/components/kit/ScoreDial';
import { Segmented } from '@/components/kit/Segmented';
import { SourceNote } from '@/components/kit/Shop';
import { StreakWeek } from '@/components/kit/Points';
import btn from '@/components/kit/controls.module.css';
import type { RepView } from '@/domain/reps';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { errorCode, errorKey, logWork, type Streak } from './api';
import { reducedMotion, weekOf } from './hooks';
import { typeName } from './text';
import st from './today.module.css';

/* ---------- header of a rep ---------- */

export function RepHeader({ rep, ask, onBack }: { rep: Pick<RepView, 'type' | 'taskShort' | 'notes' | 'kind'>; ask: ReactNode; onBack: () => void }) {
  const { t } = useT();
  return (
    <header className={st.repHead}>
      <button type="button" className={st.back} onClick={onBack}>
        <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
        {t('today.back')}
      </button>
      <h1 className={st.repTitle}>
        {typeName(t, rep.type)}
        {rep.taskShort ? (
          <>
            <span className="sr-only">: </span>
            <span className={st.taskPlate}>{rep.taskShort}</span>
          </>
        ) : null}
      </h1>
      <p className={st.repAsk}>{ask}</p>
      {rep.notes.length ? (
        <div className={st.notes}>
          {rep.notes.map((n) => (
            <SourceNote key={n}>{t(`today.notes.${n}`)}</SourceNote>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/* ---------- a tile from the Week Bar, marking which part of the week a task comes from ---------- */

export function TaskTile({ human }: { human: boolean }) {
  return <span className={st.tile} data-human={human || undefined} aria-hidden="true" />;
}

/* ---------- radio chips (task choice) ---------- */

export function ChipRadio<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className={st.chips} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={st.chip}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- «I used this at work» ---------- */

const MINUTES = ['15', '30', '60', '120'] as const;

function useWeekTasks(rep: RepView, open: boolean) {
  const { profile } = useProfile();
  const { locale } = useT();
  const [texts, setTexts] = useState<Record<string, { text: string; short: string }> | null>(null);
  useEffect(() => {
    if (!open || texts) return;
    let stop = false;
    apiFetch<{ tasks: Record<string, { text: string; short: string }> }>(`/api/occupations/${encodeURIComponent(rep.occupationCode)}/texts?locale=${locale}`, { profile: null })
      .then((r) => !stop && setTexts(r.tasks))
      .catch(() => !stop && setTexts({}));
    return () => {
      stop = true;
    };
  }, [open, texts, rep.occupationCode, locale]);
  return useMemo(() => {
    const own = { value: rep.taskId, label: rep.taskShort || rep.taskText };
    const week = [...(profile?.shares ?? [])]
      .sort((a, b) => b.share - a.share)
      .filter((s) => s.taskId !== rep.taskId)
      .map((s) => ({ value: s.taskId, label: texts?.[s.taskId]?.short ?? '' }))
      .filter((o) => o.label)
      .slice(0, 4);
    return [own, ...week];
  }, [rep, profile?.shares, texts]);
}

export function WorkLog({ rep }: { rep: RepView }) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const [open, setOpen] = useState(false);
  const tasks = useWeekTasks(rep, open);
  const [taskId, setTaskId] = useState(rep.taskId);
  const [minutes, setMinutes] = useState<(typeof MINUTES)[number]>('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ task: string; minutes: number } | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  if (done) {
    return (
      <p className={st.workDone} role="status">
        <BriefcaseBusiness size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>{t('today.workLog.done', { minutes: done.minutes, task: done.task })}</span>
      </p>
    );
  }
  if (!open) {
    return (
      <Button variant="secondary" icon={<BriefcaseBusiness strokeWidth={1.75} />} onClick={() => setOpen(true)} aria-expanded={false}>
        {t('today.result.usedAtWork')}
      </Button>
    );
  }
  const minuteLabel = (m: string) => (Number(m) >= 60 ? t('today.workLog.hours', { h: Number(m) / 60 }) : t('today.workLog.minutes', { m: Number(m) }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await logWork(taskId, Number(minutes));
      applyAwards(r.pointsAwarded, saveRef.current);
      setDone({ task: tasks.find((o) => o.value === taskId)?.label ?? rep.taskShort, minutes: Number(minutes) });
    } catch (err) {
      setError(t(errorKey(errorCode(err))));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={st.workLog} role="group" aria-labelledby="worklog-title">
      <h3 id="worklog-title" className={st.workTitle}>
        {t('today.result.usedAtWork')}
      </h3>
      <ChipRadio label={t('today.workLog.task')} options={tasks} value={taskId} onChange={setTaskId} />
      <div className={st.workRow}>
        <span className={st.workLabel} id="worklog-min">
          {t('today.workLog.minutesLabel')}
        </span>
        <Segmented label={t('today.workLog.minutesLabel')} options={MINUTES.map((m) => ({ value: m, label: minuteLabel(m) }))} value={minutes} onChange={setMinutes} />
      </div>
      {error ? (
        <p className={st.inlineError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={st.workBtns}>
        <Button ref={saveRef} size="sm" loading={busy} loadingLabel={t('today.workLog.saving')} onClick={save}>
          {t('today.workLog.save')}
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          {t('common.actions.cancel')}
        </Button>
      </div>
    </div>
  );
}

/* ---------- the result of a rep: score, streak, proof, next steps ---------- */

export function proofText(t: ReturnType<typeof useT>['t'], rep: RepView): string {
  const r = rep.result;
  if (!r) return '';
  const met = (r.criteria ?? []).filter((c) => c.status === 'met').length;
  const criteria = r.criteria?.length ?? 0;
  if (rep.type === 'slip') return t('today.result.proofSlip', { found: r.found ?? 0, total: r.total ?? 0, doc: rep.docType ?? rep.title });
  if (rep.type === 'delegate') return t('today.result.proofDelegate', { met, criteria, traps: r.trapsCaught?.length ?? 0, trapsTotal: rep.reveal?.traps?.length ?? 0 });
  return t('today.result.proofEdge', { met, criteria, task: rep.taskShort });
}

export function Outcome({
  rep,
  streak,
  fresh,
  tally,
  isFree,
  onPractice,
}: {
  rep: RepView;
  streak: Streak | null;
  /** Just checked in this tab: the score rolls and today's tile lands. */
  fresh: boolean;
  tally: ReactNode;
  isFree: boolean;
  onPractice: () => void;
}) {
  const { t } = useT();
  const r = rep.result;
  const change = r?.scoreChange;
  const counts = rep.kind !== 'extra';
  // the score and today's tile start where they were and move a beat after the marks land
  const [settled, setSettled] = useState(!fresh);
  useEffect(() => {
    if (settled) return;
    const id = window.setTimeout(() => setSettled(true), reducedMotion() ? 0 : 1100);
    return () => window.clearTimeout(id);
  }, [settled]);
  const today = rep.day;
  const week = streak ? weekOf(streak.days, settled ? undefined : today) : null;
  const streakNow = streak?.current ?? 0;

  return (
    <div className={st.outcome}>
      <div className={st.tallyWrap}>{tally}</div>

      {change && (change.before > 0 || change.after > 0) ? (
        <div className={st.outRow}>
          <ScoreDial variant="compact" value={settled ? change.after : change.before} delta={settled && change.after !== change.before ? change.after - change.before : undefined} label={t('today.result.score')} />
        </div>
      ) : null}

      {counts && week ? (
        <div className={st.outRow}>
          <StreakWeek done={week.done} today={week.today} />
          <p className={st.outNote}>{streakNow > 0 ? t('today.result.streakLine', { count: streakNow }) : t('today.result.streakStart')}</p>
        </div>
      ) : !counts ? (
        <p className={st.outNote}>{t('today.result.extraNoStreak')}</p>
      ) : null}

      <div className={st.proof}>
        <FileCheck2 size={20} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <b>{t('today.result.proof')}</b>
          <span>{proofText(t, rep)}</span>
        </div>
        {r && r.points > 0 ? <span className={st.pointsChip}>{t('today.result.points', { count: r.points })}</span> : null}
      </div>

      {isFree ? (
        <div className={st.upsell}>
          <b>{t('today.result.trialDone')}</b>
          <p>{t('today.result.trialBody')}</p>
          <Link href="/pricing" className={`${btn.btn} ${btn.b_primary}`}>
            {t('today.free.trialCta')}
          </Link>
        </div>
      ) : null}

      <div className={st.outActions}>
        {!isFree ? (
          <Button variant="primary" onClick={onPractice}>
            {t('today.result.practiseMore')}
          </Button>
        ) : null}
        <WorkLog rep={rep} />
      </div>
    </div>
  );
}

/** Small ring with a number, the same family as the editor's notes in the margin. */
export function Ring({ n, state, delay = 0 }: { n?: number; state: 'empty' | 'found' | 'missed' | 'mark' | 'partly'; delay?: number }) {
  return (
    <span className={st.ring} data-state={state} style={{ animationDelay: `${delay}ms` }} aria-hidden="true">
      {n ?? ''}
    </span>
  );
}
