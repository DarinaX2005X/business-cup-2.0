'use client';

import { CategorySwatch } from '@/components/kit/Evidence';
import { useT } from '@/i18n/client';
import { intlLocale } from '@/i18n/config';
import type { FirstWeekDay } from './firstWeek';
import st from './pricing.module.css';

/**
 * Seven days as a planner sheet: a date tile, the rep for that day and the task from the person's own
 * week it is built on. The tile beside the task carries the task's Week Bar material (hatched for the
 * machine part, apricot for the human edge), so the week reads the same way the map does.
 */
export function FirstWeekSheet({ days, labelledBy }: { days: FirstWeekDay[]; labelledBy?: string }) {
  const { t, locale } = useT();
  const weekday = new Intl.DateTimeFormat(intlLocale[locale], { weekday: 'short', timeZone: 'UTC' });
  const dayNum = new Intl.DateTimeFormat(intlLocale[locale], { day: 'numeric', timeZone: 'UTC' });
  return (
    <ol className={st.sheet} aria-labelledby={labelledBy}>
      {days.map((d, i) => {
        const date = new Date(`${d.day}T12:00:00Z`);
        return (
          <li key={d.day} className={st.sheetRow} data-today={i === 0 || undefined} style={{ animationDelay: `${i * 50}ms` }}>
            <span className={st.dateTile}>
              <small>{i === 0 ? t('pricing.week.today') : weekday.format(date)}</small>
              <b>{dayNum.format(date)}</b>
            </span>
            <span className={st.rep}>
              <span className={st.repType}>
                <CategorySwatch category={d.category} size="sm" />
                {t(`pricing.week.type.${d.type}`)}
              </span>
              <span className={st.repTask}>{d.short ?? d.text}</span>
              {d.short ? <span className={st.repText}>{d.text}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
