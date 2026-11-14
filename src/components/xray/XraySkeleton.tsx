'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { Skeleton, TaskRowSkeleton, WeekBarSkeleton } from '@/components/kit/Skeleton';
import type { XrayResult } from '@/domain/types';
import { useT } from '@/i18n/client';
import { Conclusion } from './Conclusion';
import st from './xray.module.css';

/** Written by the scan in /start right before it opens the new map (02.2, src/components/start/data.ts). */
export const FIRST_FRAME_KEY = 'irr:xray-frame';

interface FirstFrame {
  id: string;
  xray: XrayResult;
  short: Record<string, string>;
}

const noop = () => () => undefined;
const readFrame = () => {
  try {
    return window.sessionStorage.getItem(FIRST_FRAME_KEY);
  } catch {
    return null;
  }
};

/** The scan's finished frame for this map, if the person just came from /start (read until the page removes it). */
function useFirstFrame(id: string | null): FirstFrame | null {
  const raw = useSyncExternalStore(noop, readFrame, () => null);
  if (!raw || !id) return null;
  try {
    const frame = JSON.parse(raw) as FirstFrame;
    return frame.id === id && frame.xray ? frame : null;
  } catch {
    return null;
  }
}

/**
 * While the map loads: the scan's own result as the first frame when there is one (so the scan flows into
 * the map without a flash), otherwise the map's silhouette in the same places.
 */
export function XraySkeleton() {
  const { t } = useT();
  const id = usePathname()?.match(/^\/x\/([^/?#]+)/)?.[1] ?? null;
  const frame = useFirstFrame(id);
  const rest = (
    <>
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
    </>
  );

  if (frame) {
    const x = frame.xray;
    return (
      <div className={st.page} aria-busy="true">
        <Conclusion
          xray={x}
          result={x}
          delta={0}
          isOwner
          occupationTitle=""
          label={(tid) => frame.short[tid] ?? ''}
          byCategory={() => (x.percent.human_edge > 0 ? 'human_edge' : undefined)}
          labelsReady
          onMetric={() => undefined}
        />
        <div className={st.action} aria-hidden="true">
          <div className={st.aText}>
            <Skeleton width="70%" height={30} />
            <Skeleton width="55%" height={16} style={{ marginTop: 16 }} />
            <Skeleton width={220} height={60} radius={16} style={{ marginTop: 24 }} />
          </div>
        </div>
        {rest}
      </div>
    );
  }

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
      {rest}
    </div>
  );
}
