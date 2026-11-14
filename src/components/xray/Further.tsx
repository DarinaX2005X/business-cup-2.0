'use client';

import Link from 'next/link';
import { CategorySwatch } from '@/components/kit/Evidence';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import type { XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import { freedFactor } from './lib';
import type { ClientBundle } from './types';
import type { TipsState } from './useTaskTexts';
import st from './xray.module.css';

/**
 * Under the tasks: what to hand to AI first and what stays yours (the free answer to «what about my job»),
 * then the paid part: other jobs nearby and the 90-day plan, locked calmly on Free.
 */
export function Further({
  result,
  bundle,
  isPro,
  isOwner,
  label,
  tips,
  onSelect,
}: {
  result: XrayComputed;
  bundle: ClientBundle;
  isPro: boolean;
  isOwner: boolean;
  label: (id: string) => string;
  tips: TipsState;
  onSelect: (id: string) => void;
}) {
  const { t, f } = useT();
  const byId = new Map(bundle.tasks.map((x) => [x.id, x]));
  const shareOf = new Map(result.shares.map((s) => [s.taskId, s.share]));
  const hoursOf = (id: string) => ((shareOf.get(id) ?? 0) * 40) / 100;
  const n1 = (x: number) => f.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tipFor = (id: string, kind: 'hand' | 'edge') => {
    if (tips.status !== 'ready') return null;
    const tip = tips.tips[id];
    if (!tip) return null;
    if (kind === 'edge') return tip.kind === 'edge' ? tip.tip : tip.edgeTip;
    return tip.kind === 'hand' ? tip.tip : null;
  };
  const tipBody = (id: string, kind: 'hand' | 'edge') => {
    if (tips.status === 'pending') return <Skeleton width="88%" height={13} style={{ marginTop: 4 }} />;
    const tip = tipFor(id, kind);
    return tip ? <p className={st.cardTip}>{tip}</p> : null;
  };

  const trial = (
    <Link href="/pricing" className={`${btn.btn} ${btn.b_primary} ${btn.s_md}`}>
      {t('xray.pro.trial')}
    </Link>
  );
  const rel = bundle.related[0];
  const months = ['1', '2', '3'] as const;

  return (
    <>
      <section className={st.pairs} aria-label={t('xray.hand.label')}>
        <div className={st.pairCol}>
          <h2 className={st.h2}>{t('xray.hand.title')}</h2>
          {result.handToAi.length ? (
            <ul className={st.cards} role="list">
              {result.handToAi.map((id) => {
                const c = byId.get(id)?.evidence.category ?? 'ai_speeds';
                return (
                  <li key={id}>
                    <button type="button" className={st.card} data-tone="machine" onClick={() => onSelect(id)}>
                      <CategorySwatch category={c} size="lg" />
                      <span className={st.cardMain}>
                        <b className={st.cardTitle}>{label(id)}</b>
                        <span className={st.cardMeta}>{t('xray.hand.frees', { hours: n1(hoursOf(id) * freedFactor(c)) })}</span>
                        {tipBody(id, 'hand')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={st.empty}>{t('xray.hand.none')}</p>
          )}
        </div>
        <div className={st.pairCol}>
          <h2 className={st.h2}>{t('xray.edge.title')}</h2>
          {result.humanEdge.length ? (
            <ul className={st.cards} role="list">
              {result.humanEdge.map((id) => (
                <li key={id}>
                  <button type="button" className={st.card} data-tone="warm" onClick={() => onSelect(id)}>
                    <CategorySwatch category={byId.get(id)?.evidence.category ?? 'human_edge'} size="lg" />
                    <span className={st.cardMain}>
                      <b className={st.cardTitle}>{label(id)}</b>
                      <span className={st.cardMeta}>{t('xray.edge.hours', { hours: n1(hoursOf(id)) })}</span>
                      {tipBody(id, 'edge')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={st.empty}>{t('xray.edge.none')}</p>
          )}
        </div>
      </section>

      {rel ? (
        <section className={st.next} aria-labelledby="next-title">
          <h2 id="next-title" className={st.h2}>
            {t('xray.next.title')}
          </h2>
          <div className={st.nextGrid}>
            {(isPro ? bundle.related : [rel]).map((r) => (
              <article key={r.code} className={st.job}>
                <h3 className={st.jobTitle2}>{r.title}</h3>
                <p className={st.jobMatch}>{t('xray.next.similarity', { value: f.percent(r.similarity) })}</p>
                <div className={st.compare} role="img" aria-label={t('xray.next.compareLabel', { them: f.percent(r.typicalHumanShare), title: bundle.title, us: f.percent(bundle.typicalHumanShare) })}>
                  <span className={st.cmpKey}>{t('xray.next.human')}</span>
                  <span className={st.cmpRow}>
                    <span className={st.cmpName}>{r.title}</span>
                    <span className={st.cmpTrack}>
                      <i style={{ width: `${Math.max(2, r.typicalHumanShare * 100)}%` }} />
                    </span>
                    <b>{f.percent(r.typicalHumanShare)}</b>
                  </span>
                  <span className={st.cmpRow} data-muted="">
                    <span className={st.cmpName}>{bundle.title}</span>
                    <span className={st.cmpTrack}>
                      <i style={{ width: `${Math.max(2, bundle.typicalHumanShare * 100)}%` }} />
                    </span>
                    <b>{f.percent(bundle.typicalHumanShare)}</b>
                  </span>
                </div>
                <p className={st.jobPay}>
                  {r.wageDelta == null
                    ? t('xray.next.payUnknown')
                    : r.wageDelta === 0
                      ? t('xray.next.paySame')
                      : r.wageDelta > 0
                        ? t('xray.next.payMore', { delta: f.currency(r.wageDelta) })
                        : t('xray.next.payLess', { delta: f.currency(Math.abs(r.wageDelta)) })}
                </p>
                {r.missingSkills.length ? <p className={st.jobSkills}>{t('xray.next.skills', { skills: r.missingSkills.slice(0, 3).join(', ') })}</p> : null}
              </article>
            ))}
            {!isPro && bundle.relatedCount > 1 ? (
              <LockedPanel
                shape="list"
                title={t('xray.next.more', { count: bundle.relatedCount })}
                reason={t('xray.next.lockedReason')}
                action={trial}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {isOwner ? (
        <section className={st.plan} aria-labelledby="plan-title">
          <h2 id="plan-title" className={st.h2}>
            {t('xray.plan.title')}
          </h2>
          <ol className={st.months}>
            {months.map((m, i) => {
              const ids = !isPro ? [] : i === 2 ? result.humanEdge : result.handToAi;
              return (
                <li key={m} className={st.month} data-locked={!isPro || undefined}>
                  <span className={st.monthN}>{t('xray.plan.month', { n: i + 1 })}</span>
                  <h3 className={st.monthTitle}>{t(`xray.plan.m${m}`)}</h3>
                  {isPro ? (
                    <ul className={st.monthList}>
                      {ids.map((id) => (
                        <li key={id}>{t(`xray.plan.m${m}Item`, { task: label(id) })}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className={st.monthGhost} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {!isPro ? <LockedPanel shape="week" title={t('xray.plan.lockedTitle')} reason={t('xray.plan.lockedReason')} action={trial} /> : null}
        </section>
      ) : null}
    </>
  );
}
