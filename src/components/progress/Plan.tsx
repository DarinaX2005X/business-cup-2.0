'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import type { PlanResponse, PlanWeek } from '@/server/progress/types';
import { loadPlan, say, shortDay } from './api';
import st from './progress.module.css';

const weeksOf = (plan: PlanResponse) => plan.months.flatMap((m) => m.weeks.map((w) => ({ ...w, month: m.key })));

/** This week of the plan, beside the proof: the focus in one sentence and the reps done this week. */
export function PlanThisWeek({ plan }: { plan: PlanResponse }) {
  const { t, locale } = useT();
  const weeks = weeksOf(plan);
  if (plan.current >= weeks.length) {
    return (
      <section className={st.planCard} aria-labelledby="plan-now-title">
        <h2 id="plan-now-title" className={st.sideTitle}>
          {t('progress.plan.title')}
        </h2>
        <p className={st.planFocus}>{t('progress.plan.finished')}</p>
        <Link href="/start" className={`${btn.btn} ${btn.b_secondary} ${btn.s_sm}`}>
          {t('progress.empty.noMapAction')}
        </Link>
      </section>
    );
  }
  const w = weeks[plan.current];
  const onFocus = w.done.filter((d) => d.onFocus).length;
  return (
    <section className={st.planCard} aria-labelledby="plan-now-title">
      <p className={st.planWeekN}>
        <span>{t('progress.plan.weekOf', { n: w.n })}</span>
        <span>{t(`progress.plan.month.${w.month}`)}</span>
      </p>
      <h2 id="plan-now-title" className={st.planFocus}>
        {say(t, w.focus)}
      </h2>
      {w.done.length ? (
        <ul className={st.planDone}>
          {w.done.map((d) => (
            <li key={d.repId} data-focus={d.onFocus || undefined}>
              <Check size={16} strokeWidth={2.25} aria-hidden="true" />
              <span>
                {t(`progress.type.${d.type}`)}
                {d.taskShort ? `, ${d.taskShort}` : ''}
                <small>{shortDay(locale, d.day)}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={st.planNone}>{t('progress.plan.none')}</p>
      )}
      {onFocus === 0 && w.repType ? (
        <Link href="/today" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>
          {t('progress.plan.startRep')}
        </Link>
      ) : null}
      <a href="#plan" className={st.textLink}>
        {t('progress.plan.seeAll')}
      </a>
    </section>
  );
}

/** All twelve weeks in three months; the current week is marked, past weeks show how many reps they got. */
export function NinetyDayPlan({ plan, headingLevel = 2 }: { plan: PlanResponse; headingLevel?: 2 | 3 }) {
  const { t, locale } = useT();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const Hm = headingLevel === 2 ? 'h3' : 'h4';
  let index = 0;
  return (
    <section id="plan" className={st.plan} aria-labelledby="plan-title">
      <div className={st.planHead}>
        <H id="plan-title" className={st.h2}>
          {t('progress.plan.title')}
        </H>
        <p className={st.sectionLead}>{t('progress.plan.lead')}</p>
      </div>
      <ol className={st.months}>
        {plan.months.map((m) => (
          <li key={m.key} className={st.month} data-month={m.key}>
            <Hm className={st.monthTitle}>{t(`progress.plan.month.${m.key}`)}</Hm>
            <ol className={st.weeks}>
              {m.weeks.map((w: PlanWeek) => {
                const i = index++;
                const state = i < plan.current ? 'past' : i === plan.current ? 'now' : 'next';
                return (
                  <li key={w.n} className={st.week} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
                    <span className={st.weekN}>
                      {state === 'now' ? <b>{t('progress.plan.now')}</b> : null}
                      {t('progress.plan.weekOf', { n: w.n })}
                      <small>{t('progress.plan.dates', { from: shortDay(locale, w.start), to: shortDay(locale, w.end) })}</small>
                    </span>
                    <span className={st.weekFocus}>{say(t, w.focus)}</span>
                    {state !== 'next' && w.done.length ? (
                      <span className={st.weekDone}>
                        <Check size={15} strokeWidth={2.25} aria-hidden="true" />
                        {t('progress.plan.done', { count: w.done.length })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The plan that loads itself, for the week map (`src/components/xray/Further.tsx`, Pro): renders nothing
 * when the plan cannot load, so the map never shows an error for it.
 */
export function NinetyDayPlanSection({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { locale } = useT();
  const [plan, setPlan] = useState<PlanResponse | null | 'none'>(null);
  useEffect(() => {
    let stop = false;
    loadPlan(locale)
      .then((p) => !stop && setPlan(p))
      .catch(() => !stop && setPlan('none'));
    return () => {
      stop = true;
    };
  }, [locale]);
  if (plan === 'none') return null;
  if (!plan) return <Skeleton height={220} radius={20} />;
  return <NinetyDayPlan plan={plan} headingLevel={headingLevel} />;
}
