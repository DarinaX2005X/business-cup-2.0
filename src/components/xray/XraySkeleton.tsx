'use client';

import { Skeleton, TaskRowSkeleton, WeekBarSkeleton } from '@/components/kit/Skeleton';
import { useT } from '@/i18n/client';
import st from './xray.module.css';

/** The map's silhouette: the violet conclusion, the action card, the bar and the first rows land in the same places. */
export function XraySkeleton() {
  const { t } = useT();
  return (
    <div className={st.page} role="status" aria-label={t('xray.loading')}>
      <div className={`${st.conclusion} field`} data-surface="field" aria-hidden="true">
        <div className={st.cMain}>
          <span className={st.skOnField} style={{ width: '42%', height: 40 }} />
          <span className={st.skOnField} style={{ width: '30%', height: 16, marginTop: 14 }} />
          <span className={st.skOnField} style={{ width: '86%', height: 30, marginTop: 40 }} />
          <span className={st.skOnField} style={{ width: '64%', height: 30, marginTop: 12 }} />
        </div>
        <div className={st.cScore}>
          <span className={st.skOnField} style={{ width: 260, height: 140, borderRadius: '140px 140px 12px 12px' }} />
        </div>
      </div>
      <div className={st.action} aria-hidden="true">
        <div className={st.aText}>
          <Skeleton width="70%" height={30} />
          <Skeleton width="55%" height={16} style={{ marginTop: 16 }} />
          <Skeleton width={220} height={60} radius={16} style={{ marginTop: 24 }} />
        </div>
      </div>
      <section className={st.week} aria-hidden="true">
        <Skeleton width={320} height={28} style={{ marginBottom: 32 }} />
        <WeekBarSkeleton label={t('xray.loading')} />
      </section>
      <section className={st.work} aria-hidden="true">
        <div className={st.listCol}>
          <TaskRowSkeleton />
          <TaskRowSkeleton />
          <TaskRowSkeleton />
        </div>
      </section>
    </div>
  );
}
