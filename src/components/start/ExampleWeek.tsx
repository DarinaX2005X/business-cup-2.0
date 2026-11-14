'use client';

import { useMemo } from 'react';
import { CategorySwatch, groupWeek, Skeleton, useKit, weekTasksFrom } from '@/components/kit';
import { defaultShares } from '@/domain/shares';
import { computeXray } from '@/domain/xray';
import { useT } from '@/i18n/client';
import { useBundle } from './data';
import { WeekStrip } from './WeekStrip';
import st from './start.module.css';

/** The sample job of the preview: the same occupation as the sample résumé. */
const EXAMPLE_CODE = '29-1141.00';

/**
 * What the person will get, drawn from real data before they type: the typical week of a
 * registered nurse as the scan paints it (category hours from O*NET and the AI usage data, the score
 * from the same formula as the map). It is labelled as an example and never stands for their week.
 */
export function ExampleWeek() {
  const { t } = useT();
  const { s, hours } = useKit();
  const { bundle } = useBundle(EXAMPLE_CODE);

  const view = useMemo(() => {
    if (!bundle) return null;
    const shares = defaultShares(bundle);
    const tasks = weekTasksFrom(
      bundle,
      shares,
      Object.fromEntries(bundle.tasks.map((x) => [x.id, x.short ?? x.text])),
    );
    const groups = groupWeek(tasks).filter((g) => g.category !== 'no_data' || g.share >= 3);
    const { score } = computeXray(bundle, shares).result;
    return { tasks, groups, score };
  }, [bundle]);

  return (
    <aside className={st.example} aria-labelledby="example-title">
      <div className={st.exampleHead}>
        <span className={st.exampleTag}>{t('start.who.exampleTag')}</span>
        <h2 id="example-title" className={st.exampleTitle}>
          {t('start.who.exampleTitle')}
        </h2>
        <p className={st.exampleSub}>{t('start.who.exampleSub')}</p>
      </div>

      {view ? (
        <>
          <div className={st.exampleStrip}>
            <WeekStrip tasks={view.tasks} label={t('start.who.exampleTitle')} />
          </div>
          <ul className={st.exampleRows}>
            {view.groups.map((g) => (
              <li key={g.category}>
                <CategorySwatch category={g.category} size="sm" />
                <span>{s.category[g.category]}</span>
                <b>{s.hoursShort(hours(g.hours))}</b>
              </li>
            ))}
          </ul>
          <p className={st.exampleScore}>
            <span>{s.score}</span>
            <b>{view.score}</b>
          </p>
        </>
      ) : (
        <div aria-hidden="true">
          <Skeleton height={64} radius={8} />
          <Skeleton height={14} width="80%" style={{ marginTop: 20 }} />
          <Skeleton height={14} width="70%" style={{ marginTop: 12 }} />
          <Skeleton height={14} width="75%" style={{ marginTop: 12 }} />
        </div>
      )}
      <p className={st.exampleNote}>{t('start.who.exampleNote')}</p>
    </aside>
  );
}
