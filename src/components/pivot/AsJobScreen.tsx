'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { FieldArches } from '@/components/kit/Illustration';
import { LockedPanel } from '@/components/kit/Shop';
import { WeekBar } from '@/components/kit/WeekBar';
import btn from '@/components/kit/controls.module.css';
import { CupOffer } from '@/components/cup/CupOffer';
import { joinLabels } from '@/components/xray/lib';
import { useT } from '@/i18n/client';
import { hoursNum, payText, SkillChips } from './MoveCard';
import { NoMap } from './PivotScreen';
import type { AsJobView } from './types';
import st from './pivot.module.css';

/**
 * The person's week moved into one neighbouring job: the moved week as the Week Bar on the violet field,
 * what carries over (with the person's own tasks it comes from) and what would be new, then the price of
 * the move in skills and pay. A preview only: nothing is saved.
 */
export function AsJobScreen({ view, locked }: { view: AsJobView | null; locked: boolean }) {
  const { t, f, locale } = useT();
  if (locked) return <LockedMove />;
  if (!view) return <NoMap />;
  const { move } = view;
  const h = (x: number) => hoursNum(x, f);

  return (
    <div className={st.page}>
      <section className={`${st.hero} ${st.asHero} field`} aria-labelledby="as-title">
        <FieldArches className={st.arches} />
        <div className={st.asHead}>
          <Link href="/pivot" className={st.back}>
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
            {t('pivot.as.back')}
          </Link>
          <h1 id="as-title" className={st.h1} lang={move.titleEn ? 'en' : undefined}>
            {move.title}
          </h1>
          <p className={st.lead}>{view.carried > 0 ? t('pivot.as.lead', { carried: h((view.carried * 40) / 100) }) : t('pivot.as.leadNone')}</p>
          <p className={st.compare}>
            <span className={st.compareKey} aria-hidden="true" />
            {t('pivot.as.compare', { now: h(view.now.human_edge), then: h(view.then.human_edge) })}
          </p>
        </div>
        <div className={st.asBar} lang={view.labelsEn ? 'en' : undefined}>
          <WeekBar tasks={view.week} variant="violet" ariaLabel={t('pivot.as.weekLabel', { title: move.title })} />
        </div>
        <p className={st.preview}>{t('pivot.as.preview')}</p>
      </section>

      <section className={st.split}>
        <div className={st.col} aria-labelledby="carried-title">
          <h2 id="carried-title" className={st.h2}>
            {t('pivot.as.carriedTitle')}
          </h2>
          {view.carriedTasks.length ? (
            <ul className={st.rows} role="list" lang={view.labelsEn ? 'en' : undefined}>
              {view.carriedTasks.map((x) => (
                <li key={x.id} className={st.row}>
                  <span className={st.rowMain}>
                    <b>{x.label}</b>
                    {x.from.length ? <small>{t('pivot.as.from', { tasks: joinLabels(x.from, locale).join('') })}</small> : null}
                  </span>
                  <span className={st.rowH}>{t('pivot.as.hours', { hours: h(x.hours) })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={st.empty}>{t('pivot.as.carriedNone')}</p>
          )}
        </div>
        <div className={st.col} aria-labelledby="fresh-title">
          <h2 id="fresh-title" className={st.h2}>
            {t('pivot.as.freshTitle')}
          </h2>
          {view.freshTasks.length ? (
            <ul className={st.rows} role="list" lang={view.labelsEn ? 'en' : undefined}>
              {view.freshTasks.map((x) => (
                <li key={x.id} className={st.row} data-fresh="">
                  <span className={st.rowMain}>
                    <b>{x.label}</b>
                  </span>
                  <span className={st.rowH}>{t('pivot.as.hours', { hours: h(x.hours) })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={st.empty}>{t('pivot.as.freshNone')}</p>
          )}
        </div>
      </section>

      <section className={st.price} aria-label={move.title}>
        <ul className={st.priceFacts} role="list">
          <li>{t('pivot.card.match', { value: f.percent(move.similarity) })}</li>
          <li data-pay={move.pay}>{payText(move, t, f)}</li>
        </ul>
        <SkillChips move={move} />
        <div className={st.priceActions}>
          <Link href={`/jobs/${move.slug}`} className={`${btn.btn} ${btn.b_secondary}`}>
            {t('pivot.card.jobWeek')}
          </Link>
          <Link href="/pivot" className={`${btn.btn} ${btn.b_quiet}`}>
            {t('pivot.as.back')}
          </Link>
        </div>
      </section>
    </div>
  );
}

function LockedMove() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <div className={st.lockedWrap}>
        <LockedPanel
          shape="week"
          title={t('pivot.as.lockedTitle')}
          reason={t('pivot.as.lockedReason')}
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
      <p className={st.backRow}>
        <Link href="/pivot" className={`${btn.btn} ${btn.b_quiet}`}>
          {t('pivot.as.back')}
        </Link>
      </p>
    </div>
  );
}
