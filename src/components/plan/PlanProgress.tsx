'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/kit/Skeleton';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import type { PlanSummary } from '@/server/growth/types';
import { WeekTiles } from './parts';
import st from './plan.module.css';

/**
 * The plan in one line for Home and Progress: «Week 2 of 12», the week's steps as tiles, «3 of 5 done»
 * and the next step. Reads GET /api/plan/progress (never writes a plan). Without a plan yet it invites
 * the person to build one on their map's Plan tab. `xrayId` defaults to their latest map.
 */
export function PlanProgress({ xrayId, className }: { xrayId?: string | null; className?: string }) {
  const { t } = useT();
  const [s, setS] = useState<PlanSummary | null | 'error'>(null);

  useEffect(() => {
    let live = true;
    const q = xrayId ? `?xray=${encodeURIComponent(xrayId)}` : '';
    apiFetch<PlanSummary>(`/api/plan/progress${q}`)
      .then((v) => live && setS(v))
      .catch(() => live && setS('error'));
    return () => {
      live = false;
    };
  }, [xrayId]);

  if (s === 'error') return null;
  if (s === null) {
    return (
      <div className={`${st.mini} ${className ?? ''}`} aria-busy="true">
        <Skeleton width="40%" height={14} />
        <Skeleton width="70%" height={22} style={{ marginTop: 8 }} />
        <Skeleton width="55%" height={14} style={{ marginTop: 10 }} />
      </div>
    );
  }
  const href = s.xrayId ? `/x/${s.xrayId}?tab=plan` : '/start';

  if (s.status === 'none') {
    return (
      <Link href={href} className={`${st.mini} ${className ?? ''}`} data-empty="">
        <span className={st.miniTitle}>{t('plan.progress.title')}</span>
        <span className={st.miniLead}>{t('plan.progress.none')}</span>
        <span className={st.miniAction}>{t('plan.progress.build')}</span>
      </Link>
    );
  }

  return (
    <Link href={href} className={`${st.mini} ${className ?? ''}`}>
      <span className={st.miniTitle}>{t('plan.progress.title')}</span>
      <span className={st.miniWeek}>{t('plan.weekOf', { n: s.currentWeek })}</span>
      <span className={st.miniRow}>
        <WeekTiles done={s.weekDone} total={s.weekTotal} />
        <span>{t('plan.doneOf', { done: s.weekDone, total: s.weekTotal })}</span>
      </span>
      {s.next ? (
        <span className={st.miniNext}>
          <b>{t('plan.progress.next')}</b> {s.next.text}
        </span>
      ) : (
        <span className={st.miniNext}>{t('plan.progress.allDone')}</span>
      )}
      <span className={st.miniAction}>{t('plan.progress.open')}</span>
    </Link>
  );
}
