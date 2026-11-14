'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { FieldArches } from '@/components/kit/Illustration';
import { LockedPanel } from '@/components/kit/Shop';
import btn from '@/components/kit/controls.module.css';
import { CupOffer } from '@/components/cup/CupOffer';
import { useT } from '@/i18n/client';
import { rich } from '@/components/xray/rich';
import { loadCredentials } from '@/lib/client/credentials';
import { useProfile } from '@/lib/client/profile';
import { pivotExplored } from '@/app/(app)/pivot/actions';
import { InvitePanel } from './InvitePanel';
import { MiniWeek } from './MiniWeek';
import { hoursNum, MoveCard } from './MoveCard';
import type { PivotView } from './types';
import st from './pivot.module.css';

/**
 * /pivot: realistic next jobs from the person's own week. The violet block holds where they are now (their
 * week as a small bar and the hours that stay theirs); the cards below are where they could go, each drawn
 * with the same bar so the two read as «from» and «to».
 */
export function PivotScreen({ view }: { view: PivotView | null }) {
  const { t, f } = useT();
  const profile = useProfile();
  const sent = useRef(false);

  // pivot_explored: once, when the owner first opens their moves (the server pays it once in a lifetime).
  const { applyAwards } = profile;
  const explored = profile.profile?.points.events.some((e) => e.type === 'pivot_explored') ?? true;
  useEffect(() => {
    if (!view || explored || sent.current || profile.status !== 'ready') return;
    const creds = loadCredentials();
    if (!creds) return;
    sent.current = true;
    pivotExplored(creds, view.xrayId)
      .then((res) => {
        if (res.ok) applyAwards(res.pointsAwarded);
      })
      .catch(() => {
        sent.current = false;
      });
  }, [view, explored, profile.status, applyAwards]);

  if (!view) return <NoMap />;

  const locked = !view.isPro && view.total > view.moves.length ? view.total - view.moves.length : 0;
  const lead = rich(t, 'pivot.hero.lead', { job: <mark className={st.plate}>{view.jobTitle}</mark> });

  return (
    <div className={st.page}>
      <section className={`${st.hero} field`} aria-labelledby="pivot-title">
        <FieldArches className={st.arches} />
        <div className={st.heroText}>
          <h1 id="pivot-title" className={st.h1}>
            {t('pivot.hero.title')}
          </h1>
          <p className={st.lead}>{lead}</p>
        </div>
        <div className={st.now}>
          <p className={st.nowK}>{t('pivot.hero.now')}</p>
          <MiniWeek
            tiles={view.now.tiles}
            surface="violet"
            size="lg"
            label={t('pivot.card.weekLabel', {
              title: view.jobTitle,
              ai_does: hoursNum(view.now.hours.ai_does, f),
              ai_speeds: hoursNum(view.now.hours.ai_speeds, f),
              human: hoursNum(view.now.hours.human_edge, f),
            })}
          />
          <p className={st.nowHours}>{t('pivot.hero.nowHours', { hours: hoursNum(view.now.hours.human_edge, f) })}</p>
        </div>
      </section>

      {view.moves.length === 0 ? (
        <section className={st.none} aria-labelledby="none-title">
          <h2 id="none-title" className={st.h2}>
            {t('pivot.empty.noneTitle')}
          </h2>
          <p>{t('pivot.empty.noneLead')}</p>
          <Link href={`/x/${view.xrayId}`} className={`${btn.btn} ${btn.b_secondary}`}>
            {t('pivot.empty.backToMap')}
          </Link>
        </section>
      ) : (
        <section className={st.moves} aria-labelledby="moves-title">
          <h2 id="moves-title" className={st.h2}>
            {t('pivot.list.count', { count: view.total })}
          </h2>
          <ul className={st.grid} role="list">
            {view.moves.map((m, i) => (
              <li key={m.code}>
                <MoveCard move={m} index={i} />
              </li>
            ))}
          </ul>
          {locked ? (
            <div className={st.lockedWrap}>
              <LockedPanel
                shape="list"
                title={t('pivot.locked.title', { count: locked })}
                reason={t('pivot.locked.reason')}
                action={
                  <span className={st.proWays}>
                    <Link href="/pricing?from=pivot" className={`${btn.btn} ${btn.b_primary}`}>
                      {t('pivot.locked.trial')}
                    </Link>
                    <CupOffer />
                  </span>
                }
              />
            </div>
          ) : null}
        </section>
      )}

      <InvitePanel />
    </div>
  );
}

/** No map yet: what this page will show, and the one action that fills it. */
export function NoMap() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <section className={`${st.hero} ${st.heroEmpty} field`} aria-labelledby="pivot-title">
        <FieldArches className={st.arches} />
        <div className={st.heroText}>
          <h1 id="pivot-title" className={st.h1}>
            {t('pivot.empty.title')}
          </h1>
          <p className={st.lead}>{t('pivot.empty.lead')}</p>
          <Link href="/start" className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg} ${st.heroCta}`}>
            {t('pivot.empty.action')}
          </Link>
        </div>
      </section>
      <ul className={st.grid} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className={st.ghost}>
            <span className={st.ghostBand} />
            <i style={{ width: '62%' }} />
            <i style={{ width: '84%' }} />
            <i style={{ width: '48%' }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
