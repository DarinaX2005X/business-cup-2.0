'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { CategoryChip, CategorySwatch } from '@/components/kit/Evidence';
import { StreakWeek } from '@/components/kit/Points';
import { ScoreDial } from '@/components/kit/ScoreDial';
import { ShopVoucher } from '@/components/kit/Shop';
import { rewardName } from '@/components/shop/names';
import { useKit } from '@/components/kit/strings';
import { groupWeek, hoursOf } from '@/components/kit/week';
import type { Interval } from '@/components/pricing/billing';
import { Plans } from '@/components/pricing/Plans';
import { REWARDS } from '@/domain/points';
import { useT } from '@/i18n/client';
import btn from '@/components/kit/controls.module.css';
import { ArtDelegate, ArtEdge, ArtJob, ArtSlip, ArtTimer, ArtWeek } from './Art';
import { LANDING_LINKS } from './config';
import type { WeekView } from './data';
import st from './landing.module.css';

/** «How it works»: three steps down a staircase, each with its own illustration. */
export function Steps() {
  const { t } = useT();
  const steps = [
    { key: 'one', art: <ArtJob /> },
    { key: 'two', art: <ArtWeek /> },
    { key: 'three', art: <ArtTimer /> },
  ] as const;
  return (
    <section className={st.steps} aria-labelledby="steps-title">
      <div className={st.wrap}>
        <h2 id="steps-title" className={st.h2}>
          {t('landing.steps.title')}
        </h2>
        <ol className={st.stepList}>
          {steps.map((step, i) => (
            <li key={step.key} className={st.step} data-n={i + 1} style={{ '--i': i } as CSSProperties}>
              <div className={st.stepArt}>{step.art}</div>
              <span className={st.stepNo} aria-hidden="true">
                {i + 1}
              </span>
              <h3 className={st.stepTitle}>{t(`landing.steps.${step.key}.title`)}</h3>
              <p className={st.stepBody}>{t(`landing.steps.${step.key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * «What you get»: each card is one plain sentence and a real piece of the product, drawn from the
 * landing fixtures (the sample nurse week and three reps from the bank) and the live shop catalogue.
 * The pieces are shown to look at: they are inert, the work starts behind «Map my week».
 */
export function Features({ view }: { view: WeekView }) {
  const { t, f } = useT();
  const { s: kit } = useKit();
  const groups = groupWeek(view.tasks);
  const top = [...view.tasks].sort((x, y) => y.share - x.share).slice(0, 4);
  const h = (share: number) => f.number(hoursOf(share), { maximumFractionDigits: 1 });

  const machine = view.tasks.filter((x) => x.category === 'ai_does' || x.category === 'ai_speeds').sort((a, b) => b.share - a.share)[0];
  const human = view.tasks.filter((x) => x.category === 'human_edge').sort((a, b) => b.share - a.share)[0];
  const gameCards = [machine, human].filter(Boolean);

  const reward = (id: string) => REWARDS.find((r) => r.id === id);
  const vouchers = [reward('pro_10'), reward('pro_1m'), reward('claude_pro_1m')].flatMap((r) => (r && r.cost != null ? [r] : []));

  return (
    <section className={st.features} aria-labelledby="features-title">
      <div className={st.wrap}>
        <h2 id="features-title" className={st.h2}>
          {t('landing.features.title')}
        </h2>

        <div className={st.cards}>
          <article className={`field ${st.card} ${st.cardMap}`} data-surface="field">
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.map.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.map.body')}</p>
              <div className={st.dial}>
                <ScoreDial value={view.result.score} surface="violet" size={190} />
              </div>
            </div>
            <figure className={st.mapFig}>
              <ul className={st.mwTotals}>
                {groups.map((g) => (
                  <li key={g.category} data-cat={g.category}>
                    <b>{t('landing.features.map.hours', { hours: h(g.share) })}</b>
                    <span>{kit.category[g.category]}</span>
                  </li>
                ))}
              </ul>
              <div className={st.mwBar} role="img" aria-label={t('landing.features.map.caption')}>
                {groups.flatMap((g) => g.tasks).map((task, i) => (
                  <span key={task.id} data-cat={task.category} style={{ flexGrow: task.share, '--i': i } as CSSProperties} />
                ))}
              </div>
              <p className={st.mwTop}>{t('landing.features.map.top')}</p>
              <ul className={st.mwTasks}>
                {top.map((task) => (
                  <li key={task.id}>
                    <CategorySwatch category={task.category} size="sm" />
                    <span>{task.label}</span>
                    <b>{t('landing.features.map.hours', { hours: h(task.share) })}</b>
                  </li>
                ))}
              </ul>
              <figcaption>{t('landing.features.map.caption')}</figcaption>
            </figure>
          </article>

          <article className={`${st.card} ${st.cardReps}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.reps.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.reps.body')}</p>
            </div>
            <ul className={st.repRow}>
              <li className={st.repItem}>
                <div className={st.repArt}>
                  <ArtSlip />
                </div>
                <h4 className={st.repName}>{t('landing.features.reps.slip')}</h4>
                <p className={st.repBody}>{t('landing.features.reps.slipBody')}</p>
              </li>
              <li className={st.repItem}>
                <div className={st.repArt}>
                  <ArtDelegate />
                </div>
                <h4 className={st.repName}>{t('landing.features.reps.delegate')}</h4>
                <p className={st.repBody}>{t('landing.features.reps.delegateBody')}</p>
              </li>
              <li className={st.repItem}>
                <div className={st.repArt}>
                  <ArtEdge />
                </div>
                <h4 className={st.repName}>{t('landing.features.reps.edge')}</h4>
                <p className={st.repBody}>{t('landing.features.reps.edgeBody')}</p>
              </li>
            </ul>
          </article>

          <article className={`${st.card} ${st.cardGame}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.game.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.game.body')}</p>
            </div>
            <ul className={st.game}>
              {gameCards.map((task, i) => (
                <li key={task.id} className={st.gameCard} data-n={i}>
                  <span className={st.gameAsk}>{t('landing.features.game.ask')}</span>
                  <b>{task.label}</b>
                  <CategoryChip category={task.category} />
                </li>
              ))}
            </ul>
          </article>

          <article className={`${st.card} ${st.cardShop}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.shop.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.shop.body')}</p>
            </div>
            <div className={st.vouchers} inert>
              {vouchers.map((r) => (
                <div key={r.id} className={st.voucher}>
                  {r.kind === 'pro_discount' ? (
                    <ShopVoucher big={t('shop.coupon.percent', { percent: r.percentOff ?? 0 })} bigSub={t('shop.coupon.off')} brand={t('shop.pass.brand')} name={rewardName(t, r)} cost={r.cost ?? 0} balance={0} />
                  ) : r.kind === 'pro_months' ? (
                    <ShopVoucher big={t('shop.pass.months', { count: r.months ?? 1 })} bigSub={t('shop.pass.ofPro')} brand={t('shop.pass.brand')} name={rewardName(t, r)} cost={r.cost ?? 0} balance={0} />
                  ) : (
                    <ShopVoucher big="Claude Pro" bigSub={t('shop.gift.month')} brand={t('shop.gift.pilot')} tone="deep" showMark={false} name={rewardName(t, r)} cost={r.cost ?? 0} balance={0} />
                  )}
                </div>
              ))}
            </div>
          </article>

          <article className={`${st.card} ${st.cardProof}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.proof.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.proof.body')}</p>
            </div>
            <div className={st.brief}>
              <p className={st.briefTitle}>{t('landing.features.proof.sheet')}</p>
              <dl>
                <div>
                  <dt>{t('landing.features.proof.hand')}</dt>
                  {view.result.handToAi.map((id) => (
                    <dd key={id}>{view.labels[id]}</dd>
                  ))}
                </div>
                <div>
                  <dt>{t('landing.features.proof.keep')}</dt>
                  {view.result.humanEdge.map((id) => (
                    <dd key={id}>{view.labels[id]}</dd>
                  ))}
                </div>
              </dl>
            </div>
          </article>

          <article className={`${st.card} ${st.cardStreak}`}>
            <div className={st.cardText}>
              <h3 className={st.cardTitle}>{t('landing.features.streak.title')}</h3>
              <p className={st.cardBody}>{t('landing.features.streak.body')}</p>
            </div>
            <div className={st.streak}>
              <StreakWeek done={[true, true, true, true, false, false, false]} today={4} />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/** «What you pay for»: the same plan cards as /pricing, with the Business Cup 2.0 card under them. */
export function Pay() {
  const { t } = useT();
  const [interval, setBilling] = useState<Interval>('year');
  return (
    <section className={st.pay} aria-labelledby="pay-title">
      <div className={st.wrap}>
        <h2 id="pay-title" className={st.h2}>
          {t('landing.pay.title')}
        </h2>
        <div className={st.payPlans}>
          <Plans
            interval={interval}
            onInterval={setBilling}
            freeHref="/start"
            freeLabel={t('pricing.free.cta')}
            action={
              <Link href={LANDING_LINKS.pricing ?? '/start'} className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
                {t('pricing.trial')}
              </Link>
            }
          />
        </div>
      </div>
    </section>
  );
}

/** «Built on real data»: where the numbers come from, in three lines, and the way to the method page. */
export function DataNote() {
  const { t } = useT();
  return (
    <section className={st.data} aria-labelledby="data-title">
      <div className={`${st.wrap} ${st.dataIn}`}>
        <h2 id="data-title" className={st.dataTitle}>
          {t('landing.data.title')}
        </h2>
        <ul className={st.dataList}>
          <li>{t('landing.data.onet')}</li>
          <li>{t('landing.data.aei')}</li>
          <li>{t('landing.data.bls')}</li>
        </ul>
        <Link href="/method" className={st.paperLink}>
          {t('landing.data.link')}
        </Link>
      </div>
    </section>
  );
}
