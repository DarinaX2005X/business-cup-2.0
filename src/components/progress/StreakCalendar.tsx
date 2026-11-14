'use client';

import { useT } from '@/i18n/client';
import type { CalendarDay } from '@/server/progress/types';
import { dayDate, shortDay } from './api';
import st from './progress.module.css';

/**
 * Practice days of the last twelve weeks as small Week Bar tiles, a column per week, Monday on top:
 * apricot with volume where a rep was finished, a flat sunk tile where none was, a dashed outline for
 * days still ahead, today ringed. The streak sits above it in words.
 */
export function StreakCalendar({ calendar, today, current, best }: { calendar: CalendarDay[]; today: string; current: number; best: number }) {
  const { t, f, locale } = useT();
  const weekdays = t('progress.streak.weekdays').split(',');
  const weeks = Array.from({ length: Math.ceil(calendar.length / 7) }, (_, i) => calendar.slice(i * 7, i * 7 + 7));
  const practised = calendar.filter((d) => d.reps > 0).length;
  // a month label over the first week that starts in that month
  const monthOf = (day: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale === 'ru' ? 'ru-RU' : 'kk-KZ', { month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const months = weeks.map((w, i) => (i === 0 || w[0].day.slice(5, 7) !== weeks[i - 1][0].day.slice(5, 7) ? monthOf(w[0].day) : ''));

  return (
    <section className={st.streakCard} aria-labelledby="streak-title">
      <h2 id="streak-title" className="sr-only">
        {t('progress.streak.title')}
      </h2>
      <div className={st.streakHead}>
        {current > 0 ? (
          <p className={st.streakNow}>{t('progress.streak.current', { count: current })}</p>
        ) : (
          <p className={st.streakNow}>
            {t('progress.streak.none')}
            <small>{t('progress.streak.noneHint')}</small>
          </p>
        )}
        {best > 0 ? <p className={st.streakBest}>{t('progress.streak.best', { count: best })}</p> : null}
      </div>

      <div className={st.cal} role="img" aria-label={`${t('progress.streak.title')}: ${practised} / ${calendar.filter((d) => !d.future).length}`}>
        <div className={st.calDays} aria-hidden="true">
          {weekdays.map((d, i) => (
            <span key={d} style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}>
              {d}
            </span>
          ))}
        </div>
        <div className={st.calWeeks} aria-hidden="true">
          {weeks.map((w, i) => (
            <div key={w[0].day} className={st.calWeek}>
              <span className={st.calMonth}>{months[i]}</span>
              {w.map((d, k) => {
                const state = d.future ? 'future' : d.reps > 0 ? 'done' : d.before ? 'before' : 'empty';
                const title = d.reps > 0 ? t('progress.streak.cell', { count: d.reps, date: dayDate(f, d.day) }) : t('progress.streak.cellNone', { date: shortDay(locale, d.day) });
                return (
                  <i
                    key={d.day}
                    className={st.calCell}
                    data-state={state}
                    data-today={d.day === today || undefined}
                    title={d.future ? undefined : title}
                    style={state === 'done' ? { animationDelay: `${Math.min(600, (i * 7 + k) * 6)}ms` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className={st.calLegend} aria-hidden="true">
        <span>
          <i className={st.calCell} data-state="done" />
          {t('progress.streak.done')}
        </span>
        <span>
          <i className={st.calCell} data-state="empty" />
          {t('progress.streak.empty')}
        </span>
      </p>
    </section>
  );
}
