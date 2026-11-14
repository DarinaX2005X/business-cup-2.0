'use client';

import { CalendarCheck, ListChecks, Target } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CategorySwatch } from '@/components/kit/Evidence';
import type { Category, OccTask, XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { MapTab } from './MapTabs';
import st from './xray.module.css';


const GROUPS: { category: Category; key: 'does' | 'speeds' | 'yours' }[] = [
  { category: 'ai_does', key: 'does' },
  { category: 'ai_speeds', key: 'speeds' },
  { category: 'human_edge', key: 'yours' },
];

/**
 * The week in three plain parts and what to do next. Each part names its hours and its biggest tasks;
 * a task opens the Tasks tab with that task explained.
 */
export function Overview({
  result,
  byId,
  label,
  isOwner,
  pay,
  onTask,
  onTab,
}: {
  result: XrayComputed;
  byId: Map<string, OccTask>;
  label: (id: string) => string;
  isOwner: boolean;
  /** The pay line, rendered by the week section. */
  pay: ReactNode;
  onTask: (id: string) => void;
  onTab: (tab: MapTab) => void;
}) {
  const { t, f } = useT();
  const hours = (h: number) => f.number(Math.round(h));
  const sorted = [...result.shares].sort((a, b) => b.share - a.share);

  return (
    <div className={st.tabBody}>
      <div className={st.parts}>
        {GROUPS.map(({ category, key }) => {
          const top = sorted.filter((s) => byId.get(s.taskId)?.evidence.category === category).slice(0, 3);
          const h = result.hours[category];
          return (
            <section key={key} className={st.part} data-cat={category} aria-labelledby={`part-${key}`}>
              <div className={st.partHead}>
                <CategorySwatch category={category} size="lg" />
                <h3 id={`part-${key}`} className={st.partTitle}>
                  {t(`xray.overview.${key}.title`)}
                </h3>
              </div>
              <p className={st.partHours}>
                <b>{hours(h)}</b> {t('xray.overview.hoursWeek', { count: Math.round(h) })}
              </p>
              <p className={st.partWhat}>{t(`xray.overview.${key}.what`)}</p>
              {top.length ? (
                <ul className={st.partTasks}>
                  {top.map((s) => (
                    <li key={s.taskId}>
                      <button type="button" className={st.partTask} onClick={() => onTask(s.taskId)}>
                        <span>{label(s.taskId)}</span>
                        <small>{t('xray.overview.taskHours', { hours: hours((s.share * 40) / 100) })}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={st.partEmpty}>{t(`xray.overview.${key}.none`)}</p>
              )}
            </section>
          );
        })}
      </div>

      <div className={st.payRow}>{pay}</div>

      {isOwner ? (
        <section className={st.nextSteps} aria-labelledby="next-steps">
          <h3 id="next-steps" className={st.h3}>
            {t('xray.overview.next.title')}
          </h3>
          <ul className={st.stepList}>
            <li>
              <Link href="/today" className={st.step}>
                <span className={st.stepIcon} aria-hidden="true">
                  <CalendarCheck size={22} strokeWidth={1.75} />
                </span>
                <span>
                  <b>{t('xray.overview.next.rep')}</b>
                  <small>{t('xray.overview.next.repWhy')}</small>
                </span>
              </Link>
            </li>
            <li>
              <button type="button" className={st.step} onClick={() => onTab('plan')}>
                <span className={st.stepIcon} aria-hidden="true">
                  <ListChecks size={22} strokeWidth={1.75} />
                </span>
                <span>
                  <b>{t('xray.overview.next.plan')}</b>
                  <small>{t('xray.overview.next.planWhy')}</small>
                </span>
              </button>
            </li>
            <li>
              <button type="button" className={st.step} onClick={() => onTab('skills')}>
                <span className={st.stepIcon} aria-hidden="true">
                  <Target size={22} strokeWidth={1.75} />
                </span>
                <span>
                  <b>{t('xray.overview.next.skills')}</b>
                  <small>{t('xray.overview.next.skillsWhy')}</small>
                </span>
              </button>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
