'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import type { PlanResponse } from '@/server/growth/types';
import { PlanText } from './parts';
import st from './print.module.css';

/**
 * The 90-day plan laid out for A4 paper: three months, twelve weeks, each step with a box to tick by hand
 * (ticked when it is already done). Used by «Download plan as PDF» on the Plan tab and by the PDF report
 * at /x/[id]/report. Free plans print week 1 only.
 *
 * Server pages get the data with `readPlanForReport(profile, xrayId)` from `@/server/growth`; client pages
 * can use `PlanPrintSectionFor`.
 */
export function PlanPrintSection({ plan }: { plan: PlanResponse }) {
  const { t, f } = useT();
  const done = new Set(plan.done);
  const weeks = plan.weeks.filter((w) => w.items.length > 0);
  return (
    <section className={st.print} aria-labelledby="plan-print-title">
      <header className={st.head}>
        <h2 id="plan-print-title" className={st.title}>
          {t('plan.print.title')}
        </h2>
        <p className={st.sub}>
          <span>{t('plan.print.for', { job: plan.jobTitle })}</span>
          <span>{t('plan.print.started', { date: f.date(`${plan.startDay}T00:00:00Z`, 'long') })}</span>
        </p>
      </header>
      {([1, 2, 3] as const).map((m) => {
        const ofMonth = weeks.filter((w) => w.month === m);
        if (!ofMonth.length) return null;
        return (
          <div key={m} className={st.month}>
            <h3 className={st.monthTitle}>
              <span>{t('plan.monthN', { n: m })}</span> {t(`plan.months.${m}`)}
            </h3>
            {ofMonth.map((w) => (
              <article key={w.n} className={st.week}>
                <h4 className={st.weekTitle}>
                  <span className={st.weekN}>{t('plan.weekN', { n: w.n })}</span>
                  <span>{w.focus}</span>
                </h4>
                <ul className={st.items}>
                  {w.items.map((i) => (
                    <li key={i.id} data-done={done.has(i.id) || undefined}>
                      <span className={st.box} aria-hidden="true" />
                      <span className={st.text}>
                        <PlanText item={i} />
                      </span>
                      <span className={st.kind}>{i.kind === 'rep' && i.repType ? t(`plan.rep.${i.repType}`) : t(`plan.kind.${i.kind}`)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        );
      })}
      <p className={st.foot}>{t('plan.print.made')}</p>
    </section>
  );
}

/** Loads the stored plan of a map (never writes one) and prints it; says so when there is none yet. */
export function PlanPrintSectionFor({ xrayId }: { xrayId: string }) {
  const { t } = useT();
  const [plan, setPlan] = useState<PlanResponse | null | 'none'>(null);
  useEffect(() => {
    let live = true;
    apiFetch<PlanResponse>(`/api/plan?xray=${encodeURIComponent(xrayId)}&generate=0`)
      .then((p) => live && setPlan(p))
      .catch(() => live && setPlan('none'));
    return () => {
      live = false;
    };
  }, [xrayId]);
  if (plan === null) return null;
  if (plan === 'none') return <p className={st.notYet}>{t('plan.print.notYet')}</p>;
  return <PlanPrintSection plan={plan} />;
}
