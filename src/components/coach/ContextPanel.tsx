'use client';

import Link from 'next/link';
import { CategorySwatch } from '@/components/kit/Evidence';
import type { Category } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { CoachSnapshot } from './api';
import st from './coach.module.css';

const ORDER: Category[] = ['ai_does', 'ai_speeds', 'human_edge', 'no_data'];
const TILE: Record<Category, string> = { ai_does: st.segAi, ai_speeds: st.segSp, human_edge: st.segHu, no_data: st.segNd };

/** The person's week in one strip: hatched machine parts, the warm human part, widths by hours. */
export function WeekStrip({ hours, label }: { hours: Record<Category, number>; label: string }) {
  const total = ORDER.reduce((n, c) => n + (hours[c] ?? 0), 0) || 40;
  return (
    <div className={st.strip} role="img" aria-label={label}>
      {ORDER.filter((c) => hours[c] > 0).map((c) => (
        <span key={c} className={`${st.seg} ${TILE[c]}`} style={{ flexGrow: hours[c] / total }} />
      ))}
    </div>
  );
}

/**
 * «What your coach knows»: the numbers the coach reads before every answer, each one a link to where it
 * lives. On narrow screens it folds into one line above the conversation.
 */
export function ContextPanel({ me }: { me: CoachSnapshot }) {
  const { t, f } = useT();
  const weekLabel = ORDER.filter((c) => me.hours[c] > 0)
    .map((c) => `${t(`coach.cat.${c}`)} ${t('coach.sees.hours', { hours: me.hours[c] })}`)
    .join(', ');
  const rows: { label: string; value: string; href: string }[] = [
    { label: t('coach.sees.streak'), value: t('coach.sees.days', { count: me.streak }), href: '/progress' },
    { label: t('coach.sees.reps'), value: f.integer(me.reps), href: '/progress' },
    { label: t('coach.sees.points'), value: f.integer(me.points), href: '/shop' },
    { label: t('coach.sees.plan'), value: me.plan ? t('coach.sees.planDone', { done: me.plan.done, total: me.plan.total }) : t('coach.sees.planNone'), href: `/x/${me.xrayId}` },
    { label: t('coach.sees.skills'), value: me.skills !== null ? t('coach.sees.skillsCount', { count: me.skills }) : t('coach.sees.skillsNone'), href: `/x/${me.xrayId}` },
    ...(me.nextJob ? [{ label: t('coach.sees.next'), value: me.nextJob.title, href: `/pivot/${me.nextJob.slug}` }] : []),
  ];

  const body = (
    <>
      <div className={st.seesHead}>
        <p className={st.seesJob}>{me.jobTitle}</p>
        <p className={st.seesScore}>
          <span className={st.seesScoreNum}>{me.score}</span>
          <span className={st.seesScoreOf}>
            {t('coach.sees.of100')}
            <br />
            {t('coach.sees.score')}
          </span>
        </p>
      </div>

      <div className={st.seesWeek}>
        <p className={st.seesLabel}>{t('coach.sees.week')}</p>
        <WeekStrip hours={me.hours} label={weekLabel} />
        <ul className={st.legend}>
          {ORDER.filter((c) => me.hours[c] > 0).map((c) => (
            <li key={c}>
              <CategorySwatch category={c} size="sm" />
              <span>{t(`coach.cat.${c}`)}</span>
              <b>{t('coach.sees.hours', { hours: me.hours[c] })}</b>
            </li>
          ))}
        </ul>
      </div>

      {me.payAtStake !== null && me.payAtStake > 0 ? (
        <p className={st.stake}>
          <b>{t('coach.sees.atStake', { amount: f.currency(me.payAtStake) })}</b>
          <span>{me.salarySource === 'user' ? t('coach.sees.fromSalary') : t('coach.sees.fromMedian')}</span>
        </p>
      ) : null}

      {me.tasks.length ? (
        <div className={st.seesTasks}>
          <p className={st.seesLabel}>{t('coach.sees.tasks')}</p>
          <ul>
            {me.tasks.slice(0, 4).map((task) => (
              <li key={task.id}>
                <CategorySwatch category={task.category} size="sm" />
                <span className={st.taskName}>{task.label}</span>
                <b>{t('coach.sees.hours', { hours: task.hours })}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className={st.facts}>
        {rows.map((r) => (
          <li key={r.label}>
            <Link href={r.href} className={st.fact}>
              <span>{r.label}</span>
              <b>{r.value}</b>
            </Link>
          </li>
        ))}
      </ul>

      <Link href={`/x/${me.xrayId}`} className={st.openMap}>
        {t('coach.sees.open')}
      </Link>
    </>
  );

  return (
    <>
      <section className={`${st.sees} ${st.wideOnly}`} aria-labelledby="coach-sees">
        <h2 id="coach-sees" className={st.seesTitle}>
          {t('coach.sees.title')}
        </h2>
        {body}
      </section>
      <details className={`${st.seesFold} ${st.narrowOnly}`}>
        <summary>
          <span className={st.foldJob}>
            <b>{me.jobTitle}</b>
            <span>
              {t('coach.sees.score')} {me.score}
            </span>
          </span>
          <WeekStrip hours={me.hours} label={weekLabel} />
          <span className="sr-only">{t('coach.sees.toggle')}</span>
        </summary>
        <div className={st.foldBody}>{body}</div>
      </details>
    </>
  );
}
