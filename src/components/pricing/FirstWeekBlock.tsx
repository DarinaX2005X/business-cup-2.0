'use client';

import { useEffect, useState } from 'react';
import { planOf } from '@/components/cup/plan';
import { localDay } from '@/domain/reps';
import type { OccupationBundle, XrayResult } from '@/domain/types';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { PRO_YEARLY_USD } from './billing';
import { planFirstWeek, type FirstWeekView } from './firstWeek';
import { FirstWeekSheet } from './FirstWeekSheet';
import { TrialBox } from './PricingPage';
import st from './pricing.module.css';

/**
 * The first week of reps as a block for other screens (Today, after the free rep): the same plan as
 * `/pricing?from=<xrayId>`, computed in the browser from the map, the public occupation bundle and the
 * task labels. Renders nothing until the plan is ready, and nothing for a visitor who already has Pro.
 */
export function FirstWeekBlock({ xrayId }: { xrayId: string }) {
  const { t, f, locale } = useT();
  const prof = useProfile();
  const profile = prof.profile;
  const [week, setWeek] = useState<FirstWeekView | null>(null);

  const profileId = profile?.id;
  const repLog = profile?.repLog;
  const tz = profile?.tz ?? null;
  const shares = profile?.lastXrayId === xrayId && profile?.shares?.length ? profile.shares : null;

  useEffect(() => {
    if (!profileId || !repLog) return;
    let stop = false;
    (async () => {
      try {
        const { xray, isOwner } = await apiFetch<{ xray: XrayResult; isOwner: boolean }>(`/api/xray/${encodeURIComponent(xrayId)}`);
        if (!isOwner) return;
        const code = encodeURIComponent(xray.occupationCode);
        const [bundle, texts] = await Promise.all([
          fetch(`/data/occ/${code}.json`).then((r) => (r.ok ? (r.json() as Promise<OccupationBundle>) : null)),
          apiFetch<{ tasks: Record<string, { text: string; short: string }> }>(`/api/occupations/${code}/texts?locale=${locale}`, { profile: null }).catch(() => null),
        ]);
        if (stop || !bundle?.tasks.length) return;
        const byId = new Map(bundle.tasks.map((x) => [x.id, x]));
        const plan = planFirstWeek({ profileId, tasks: bundle.tasks, shares: shares ?? xray.shares, repLog, startDay: localDay(new Date(), tz) });
        setWeek({
          xrayId,
          jobTitle: xray.jobTitle,
          score: xray.score,
          days: plan.map((d) => ({
            ...d,
            short: texts?.tasks[d.taskId]?.short ?? null,
            text: texts?.tasks[d.taskId]?.text ?? byId.get(d.taskId)?.text ?? '',
            category: byId.get(d.taskId)?.evidence.category ?? 'no_data',
          })),
        });
      } catch {
        // The block is extra: without it the screen is complete.
      }
    })();
    return () => {
      stop = true;
    };
  }, [xrayId, profileId, repLog, tz, shares, locale]);

  const plan = planOf(profile?.plan);
  if (!week || plan.active) return null;

  return (
    <section className={st.block} aria-labelledby="first-week-title">
      <div className={st.personalText}>
        <h2 id="first-week-title" className={st.h2}>
          {t('pricing.week.title')}
        </h2>
        <p className={st.lead}>{t('pricing.week.lead', { jobTitle: week.jobTitle })}</p>
        <p className={st.move}>
          <b>{t('pricing.week.score', { score: week.score })}</b> {t('pricing.week.move')}
        </p>
        <TrialBox
          surface="paper"
          interval="year"
          plan={plan}
          hasMap
          priceLine={t('pricing.pro.trialLine', { price: f.currency(PRO_YEARLY_USD), per: t('pricing.pro.perYear') })}
        />
      </div>
      <FirstWeekSheet days={week.days} labelledBy="first-week-title" />
    </section>
  );
}
