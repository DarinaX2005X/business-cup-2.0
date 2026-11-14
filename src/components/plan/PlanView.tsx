'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CupOffer } from '@/components/cup/CupOffer';
import { Button } from '@/components/kit/Button';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import { sound } from '@/components/kit/sound';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { useOptionalProfile } from '@/lib/client/profile';
import type { RepType } from '@/domain/types';
import type { PlanCheckResponse, PlanItem, PlanPending, PlanResponse, PlanWeek } from '@/server/growth/types';
import { linkFor, PlanText, WeekTiles } from './parts';
import { PlanPrintSection } from './PlanPrintSection';
import st from './plan.module.css';

type State = { kind: 'loading' } | { kind: 'ready'; plan: PlanResponse } | { kind: 'error'; code: string };

const POLL_MS = 4000;
const POLL_MAX = 45;

/**
 * The Plan tab of the week map: the week the calendar is in, large, with steps to check off; the twelve
 * weeks under it by month; the PDF. Free sees week 1 and the rest locked. Everything comes from
 * GET /api/plan, which writes the plan the first time (about half a minute) and reads it afterwards.
 */
export function PlanView({ xrayId }: { xrayId: string }) {
  const { t } = useT();
  const profileCtx = useOptionalProfile();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [slow, setSlow] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const [viewWeek, setViewWeek] = useState<number | null>(null);
  const [justDone, setJustDone] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [live, setLive] = useState('');
  const timer = useRef(0);
  const polls = useRef(0);
  const alive = useRef(true);
  const pendingOps = useRef(new Map<string, boolean>());
  /** The next poll while the plan is being written (set below, read from the timer). */
  const poll = useRef<() => Promise<void>>(async () => undefined);

  const accept = useCallback((plan: PlanResponse) => {
    setState({ kind: 'ready', plan });
    setDone(new Set(plan.done));
    setSlow(false);
  }, []);

  const load = useCallback(
    async (request: () => Promise<PlanResponse | PlanPending>) => {
      window.clearTimeout(timer.current);
      const slowTimer = window.setTimeout(() => alive.current && setSlow(true), 1200);
      try {
        const res = await request();
        if (!alive.current) return;
        if (res.status === 'generating') {
          setSlow(true);
          if (++polls.current > POLL_MAX) {
            setState({ kind: 'error', code: 'ai_unavailable' });
            return;
          }
          timer.current = window.setTimeout(() => void poll.current(), POLL_MS);
          return;
        }
        polls.current = 0;
        accept(res);
      } catch (err) {
        if (alive.current) setState({ kind: 'error', code: err instanceof ApiError ? err.code : 'generic' });
      } finally {
        window.clearTimeout(slowTimer);
      }
    },
    [accept],
  );

  const fetchPlan = useCallback(() => load(() => apiFetch<PlanResponse | PlanPending>(`/api/plan?xray=${encodeURIComponent(xrayId)}`)), [load, xrayId]);
  useEffect(() => {
    poll.current = fetchPlan;
  }, [fetchPlan]);

  useEffect(() => {
    alive.current = true;
    // Started from a task, so the request and its state changes never run inside the effect itself.
    timer.current = window.setTimeout(() => void fetchPlan(), 0);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, [fetchPlan]);

  const retry = () => {
    polls.current = 0;
    setState({ kind: 'loading' });
    void fetchPlan();
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(() => apiFetch<PlanResponse | PlanPending>('/api/plan', { method: 'POST', body: { xray: xrayId, refresh: true } }));
    if (alive.current) setRefreshing(false);
  };

  const toggle = async (item: PlanItem, week: number, el: HTMLElement | null) => {
    if (busy.has(item.id) || state.kind !== 'ready') return;
    const next = !done.has(item.id);
    pendingOps.current.set(item.id, next);
    setFailed(null);
    setBusy((b) => new Set(b).add(item.id));
    setDone((d) => {
      const n = new Set(d);
      if (next) n.add(item.id);
      else n.delete(item.id);
      return n;
    });
    setLive(t(next ? 'plan.checkedLive' : 'plan.uncheckedLive', { text: item.text }));
    setFresh(next ? item.id : null);
    if (next) {
      sound.play('found');
      const w = state.plan.weeks.find((x) => x.n === week);
      if (w && w.items.every((i) => i.id === item.id || done.has(i.id))) {
        setJustDone(week);
        setLive(t('plan.weekComplete', { n: week }));
      }
    } else if (justDone === week) setJustDone(null);
    try {
      const res = await apiFetch<PlanCheckResponse>('/api/plan/check', { method: 'POST', body: { itemId: item.id, done: next, xray: xrayId } });
      pendingOps.current.delete(item.id);
      if (!alive.current) return;
      setDone(() => {
        const n = new Set(res.doneIds);
        // Other steps still on their way keep the state the person gave them.
        for (const [id, v] of pendingOps.current) {
          if (v) n.add(id);
          else n.delete(id);
        }
        return n;
      });
      profileCtx?.applyAwards(res.pointsAwarded, el);
    } catch {
      pendingOps.current.delete(item.id);
      if (!alive.current) return;
      setDone((d) => {
        const n = new Set(d);
        if (next) n.delete(item.id);
        else n.add(item.id);
        return n;
      });
      setFailed(item.id);
      if (justDone === week) setJustDone(null);
    } finally {
      if (alive.current)
        setBusy((b) => {
          const n = new Set(b);
          n.delete(item.id);
          return n;
        });
    }
  };

  // «Download plan as PDF»: the print sheet is laid on the page only while the print dialog is open.
  useEffect(() => {
    if (!printing) return;
    const style = document.createElement('style');
    style.textContent = '@media print { body > *:not([data-plan-print]) { display: none !important; } @page { size: A4; margin: 14mm 14mm 16mm; } }';
    document.head.appendChild(style);
    const end = () => setPrinting(false);
    window.addEventListener('afterprint', end);
    const go = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(go);
      window.removeEventListener('afterprint', end);
      style.remove();
    };
  }, [printing]);

  const plan = state.kind === 'ready' ? state.plan : null;
  const shownWeek = plan ? (viewWeek ?? (plan.locked ? 1 : plan.currentWeek)) : 1;
  const week = plan?.weeks.find((w) => w.n === shownWeek) ?? null;
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const w of plan?.weeks ?? []) m.set(w.n, w.items.filter((i) => done.has(i.id)).length);
    return m;
  }, [plan, done]);

  if (state.kind === 'loading') return <Generating slow={slow} />;

  if (state.kind === 'error') {
    const msg = state.code === 'no_xray' ? 'plan.error.noXray' : state.code === 'ai_unavailable' || state.code === 'rate_limited' ? 'plan.error.ai' : 'plan.error.generic';
    return (
      <section className={st.problem} role="alert">
        <h2 className={st.problemTitle}>{t('plan.error.title')}</h2>
        <p>{t(msg)}</p>
        <Button variant="primary" onClick={retry}>
          {t('plan.retry')}
        </Button>
      </section>
    );
  }

  const p = state.plan;
  const trial = (
    <span className={st.proWays}>
      <Link href={`/pricing?from=${xrayId}`} className={`${btn.btn} ${btn.b_primary} ${btn.s_md}`}>
        {t('xray.pro.trial')}
      </Link>
      <CupOffer onUnlocked={retry} />
    </span>
  );

  return (
    <div className={st.plan}>
      {p.stale && !p.locked ? (
        <div className={st.stale}>
          <p>
            {t('plan.stale.lead')} <span className={st.staleKeep}>{t('plan.stale.keeps')}</span>
          </p>
          <Button variant="secondary" size="sm" loading={refreshing} loadingLabel={t('plan.stale.updating')} onClick={refresh}>
            {t('plan.stale.action')}
          </Button>
        </div>
      ) : null}

      <div className={st.layout}>
        {week ? (
          <WeekSheet
            key={week.n}
            week={week}
            plan={p}
            done={done}
            busy={busy}
            failed={failed}
            fresh={fresh}
            celebrate={justDone === week.n}
            onToggle={toggle}
            onBack={week.n !== p.currentWeek && !p.locked ? () => setViewWeek(null) : null}
          />
        ) : null}

        <section className={st.overview} aria-labelledby="plan-overview">
          <div className={st.overviewHead}>
            <h3 id="plan-overview" className={st.h3}>
              {t('plan.overview.title')}
            </h3>
            <Button variant="quiet" size="sm" icon={<Download size={18} strokeWidth={1.75} />} loading={printing} loadingLabel={t('plan.preparing')} onClick={() => setPrinting(true)}>
              {t('plan.download')}
            </Button>
          </div>
          {([1, 2, 3] as const).map((m) => (
            <div key={m} className={st.month}>
              <p className={st.monthHead}>
                <span className={st.monthN}>{t('plan.monthN', { n: m })}</span>
                <b>{t(`plan.months.${m}`)}</b>
              </p>
              <ol className={st.weekRows}>
                {p.weeks
                  .filter((w) => w.month === m)
                  .map((w) => {
                    const locked = Boolean((w as PlanWeek & { locked?: boolean }).locked);
                    const n = counts.get(w.n) ?? 0;
                    const total = w.items.length;
                    return (
                      <li key={w.n}>
                        <button
                          type="button"
                          className={st.weekRow}
                          data-selected={w.n === shownWeek || undefined}
                          data-now={(!p.locked && w.n === p.currentWeek) || undefined}
                          data-locked={locked || undefined}
                          data-complete={(total > 0 && n === total) || undefined}
                          disabled={locked}
                          aria-current={w.n === shownWeek ? 'true' : undefined}
                          onClick={() => setViewWeek(w.n === p.currentWeek ? null : w.n)}
                        >
                          <span className={st.weekTile} style={{ '--fill': total ? n / total : 0 } as CSSProperties} aria-hidden="true">
                            {locked ? <Lock size={14} strokeWidth={2} /> : total > 0 && n === total ? <Check size={16} strokeWidth={2.5} /> : w.n}
                          </span>
                          <span className={st.weekRowText}>
                            <span className={st.weekRowName}>
                              {t('plan.weekN', { n: w.n })}
                              {!p.locked && w.n === p.currentWeek ? <em className={st.nowTag}>{t('plan.thisWeek')}</em> : null}
                            </span>
                            <span className={st.weekRowFocus}>{locked ? t('plan.overview.locked') : w.focus}</span>
                          </span>
                          {!locked && total ? <span className={st.weekRowCount}>{t('plan.doneOf', { done: n, total })}</span> : null}
                        </button>
                      </li>
                    );
                  })}
              </ol>
            </div>
          ))}
        </section>
      </div>

      {p.locked ? <LockedPanel shape="list" title={t('plan.locked.title')} reason={t('plan.locked.reason')} action={trial} /> : null}

      <span className="sr-only" aria-live="polite">
        {live}
      </span>
      {printing
        ? createPortal(
            <div data-plan-print="" className={st.printRoot}>
              <PlanPrintSection plan={{ ...p, done: [...done] }} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function WeekSheet({
  week,
  plan,
  done,
  busy,
  failed,
  fresh,
  celebrate,
  onToggle,
  onBack,
}: {
  week: PlanWeek;
  plan: PlanResponse;
  done: Set<string>;
  busy: Set<string>;
  failed: string | null;
  fresh: string | null;
  celebrate: boolean;
  onToggle: (item: PlanItem, week: number, el: HTMLElement | null) => void;
  onBack: (() => void) | null;
}) {
  const { t, f } = useT();
  const n = week.items.filter((i) => done.has(i.id)).length;
  const total = week.items.length;
  const startDay = new Date(`${plan.startDay}T00:00:00Z`);
  startDay.setUTCDate(startDay.getUTCDate() + (week.n - 1) * 7);
  const future = week.n > plan.currentWeek && !plan.locked;
  return (
    <section className={st.sheet} data-celebrate={celebrate || undefined} aria-labelledby={`plan-week-${week.n}`}>
      <header className={st.sheetHead}>
        <p className={st.sheetMeta}>
          <span className={st.sheetWeek}>{t('plan.weekOf', { n: week.n })}</span>
          <span>{t(`plan.months.${week.month}`)}</span>
          {future ? <span>{t('plan.starts', { date: f.date(startDay, 'medium') })}</span> : null}
        </p>
        <h2 id={`plan-week-${week.n}`} className={st.focus}>
          {week.focus}
        </h2>
        <div className={st.sheetProgress}>
          <WeekTiles done={n} total={total} />
          <span>{t('plan.doneOf', { done: n, total })}</span>
        </div>
      </header>
      <ol className={st.items}>
        {week.items.map((item, i) => {
          const on = done.has(item.id);
          const link = linkFor(item);
          const label = item.kind === 'rep' && item.repType ? t(`plan.rep.${item.repType}`) : t(`plan.kind.${item.kind}`);
          return (
            <li key={item.id} className={st.item} data-done={on || undefined} style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                className={st.check}
                aria-pressed={on}
                aria-label={`${t(on ? 'plan.uncheck' : 'plan.check')}: ${item.text}`}
                aria-busy={busy.has(item.id) || undefined}
                data-fresh={(on && fresh === item.id) || undefined}
                onClick={(e) => onToggle(item, week.n, e.currentTarget)}
              >
                <span className={st.checkMark} aria-hidden="true">
                  <Check size={18} strokeWidth={3} />
                </span>
              </button>
              <div className={st.itemBody}>
                <p className={st.itemText}>
                  <PlanText item={item} />
                </p>
                <p className={st.itemMeta}>
                  <span className={st.kindTag} data-kind={item.kind}>
                    {label}
                  </span>
                  {item.kind === 'rep' && item.repType && item.taskId ? (
                    <StartRep type={item.repType} taskId={item.taskId} />
                  ) : link ? (
                    <Link href={link.href} className={st.itemLink}>
                      {t(link.key)}
                    </Link>
                  ) : null}
                </p>
                {failed === item.id ? (
                  <p className={st.itemError} role="alert">
                    {t('plan.saveFailed')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {total > 0 && n === total ? <p className={st.weekDone}>{week.n === 12 ? t('plan.allComplete') : t('plan.weekComplete', { n: week.n })}</p> : null}
      {onBack ? (
        <button type="button" className={st.back} onClick={onBack}>
          {t('plan.backToNow')}
        </button>
      ) : null}
    </section>
  );
}

/**
 * Starts the rep a step names, on its own task (POST /api/reps with the task; today's daily rep if it is
 * still free, else an extra), and opens it on Today. When the rep cannot start here, Today opens as usual.
 */
function StartRep({ type, taskId }: { type: RepType; taskId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    type Started = { rep: { id: string } } | { repId: string };
    const post = (kind: 'daily' | 'extra') => apiFetch<Started>('/api/reps', { method: 'POST', body: { type, kind, taskId } });
    try {
      let res: Started;
      try {
        res = await post('daily');
      } catch (err) {
        if (!(err instanceof ApiError && err.code === 'daily_exists')) throw err;
        res = await post('extra');
      }
      router.push(`/today?rep=${encodeURIComponent('rep' in res ? res.rep.id : res.repId)}`);
    } catch {
      router.push('/today');
    }
  };
  return (
    <button type="button" className={st.itemLink} data-button="" disabled={busy} aria-busy={busy || undefined} onClick={start}>
      {busy ? t('plan.go.starting') : t('plan.go.startRep')}
    </button>
  );
}

function Generating({ slow }: { slow: boolean }) {
  const { t } = useT();
  return (
    <div className={st.layout} aria-busy="true">
      <section className={st.sheet} data-pending="">
        {slow ? (
          <header className={st.sheetHead}>
            <h2 className={st.genTitle}>{t('plan.generating.title')}</h2>
            <p className={st.genLead}>{t('plan.generating.lead')}</p>
          </header>
        ) : (
          <header className={st.sheetHead}>
            <Skeleton width="34%" height={14} />
            <Skeleton width="72%" height={34} style={{ marginTop: 12 }} />
          </header>
        )}
        <div className={st.genLines} aria-hidden="true">
          {[86, 70, 78, 64].map((w, i) => (
            <div key={i} className={st.genLine}>
              <i className={st.genDot} />
              <Skeleton width={`${w}%`} height={16} />
            </div>
          ))}
        </div>
      </section>
      <section className={st.overview} aria-hidden="true">
        <div className={st.genQuarter}>
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      </section>
    </div>
  );
}
