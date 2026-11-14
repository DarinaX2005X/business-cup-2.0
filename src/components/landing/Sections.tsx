'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CategoryChip } from '@/components/kit/Evidence';
import { SheetStack } from '@/components/kit/Illustration';
import { StreakWeek } from '@/components/kit/Points';
import { RepCard } from '@/components/kit/RepCard';
import { ScoreDial } from '@/components/kit/ScoreDial';
import { ShopVoucher } from '@/components/kit/Shop';
import { WeekBar } from '@/components/kit/WeekBar';
import { rewardName } from '@/components/shop/names';
import { WeekStrip } from '@/components/start/WeekStrip';
import { DocText, type Spot } from '@/components/today/DocText';
import { CUP_OFFER_UNTIL, PRO_PRICES, REWARDS } from '@/domain/points';
import { useT } from '@/i18n/client';
import { LANDING_LINKS } from './config';
import type { RepSamples, WeekView } from './data';
import st from './landing.module.css';

const initialOf = (persona: string) => (persona.trim().match(/\p{L}/u)?.[0] ?? '').toUpperCase();

/** «How it works»: three steps, each with a piece of the product instead of an icon. */
export function Steps({ view }: { view: WeekView }) {
  const { t } = useT();
  const typed = view.jobTitle.split(',')[0];
  return (
    <section className={st.steps} aria-labelledby="steps-title">
      <div className={st.wrap}>
        <h2 id="steps-title" className={st.h2}>
          {t('landing.steps.title')}
        </h2>
        <ol className={st.stepList}>
          <li className={st.step}>
            <div className={st.stepArt} aria-hidden="true">
              <span className={st.typed}>{typed}</span>
            </div>
            <h3 className={st.stepTitle}>{t('landing.steps.one.title')}</h3>
            <p className={st.stepBody}>{t('landing.steps.one.body')}</p>
          </li>
          <li className={st.step}>
            <div className={st.stepArt}>
              <div className={st.stepStrip}>
                <WeekStrip tasks={view.tasks} label={t('landing.features.map.caption')} />
              </div>
            </div>
            <h3 className={st.stepTitle}>{t('landing.steps.two.title')}</h3>
            <p className={st.stepBody}>{t('landing.steps.two.body')}</p>
          </li>
          <li className={st.step}>
            <div className={st.stepArt} aria-hidden="true">
              <SheetStack className={st.stepSheets} fit="contain" />
            </div>
            <h3 className={st.stepTitle}>{t('landing.steps.three.title')}</h3>
            <p className={st.stepBody}>{t('landing.steps.three.body')}</p>
          </li>
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
export function Features({ view, reps }: { view: WeekView; reps: RepSamples }) {
  const { t, locale } = useT();
  const [scanning, setScanning] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // The scan that paints a week in the product plays once, when the bar first comes into view.
  useEffect(() => {
    const el = barRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setScanning(true);
        timer = window.setTimeout(() => setScanning(false), 2800);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const { slip, delegate, edge } = reps;
  const tableAt = Math.max(0, delegate.inputs.indexOf('| '));
  const table = delegate.inputs.slice(tableAt);
  const spots: Spot[] = delegate.shownTrap.spots.filter(([a]) => a >= tableAt).map(([a, b]) => ({ start: a - tableAt, end: b - tableAt, kind: 'caught' }));

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
              <p className={st.cardNote}>{t('landing.features.map.stake')}</p>
              <div className={st.dial}>
                <ScoreDial value={view.result.score} surface="violet" size={190} />
              </div>
            </div>
            <figure className={st.mapFig}>
              <div ref={barRef} inert>
                <WeekBar tasks={view.tasks} variant="violet" scanning={scanning} ariaLabel={t('landing.features.map.caption')} />
              </div>
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
                <div className={st.repArt} role="img" aria-label={slip.title} lang="en">
                  <div className={st.repSheet} inert>
                    <RepCard document={slip.document} mode="answer" ranges={[]} stack={false} />
                  </div>
                </div>
                <h4 className={st.repName}>{t('landing.features.reps.slip')}</h4>
                <p className={st.repBody}>{t('landing.features.reps.slipBody')}</p>
              </li>
              <li className={st.repItem}>
                <div className={st.repArt} lang="en">
                  <div className={st.repTable}>
                    <DocText src={table} spots={spots} />
                  </div>
                  <p className={st.trap} lang={locale}>
                    {t('landing.features.reps.trap')}
                  </p>
                </div>
                <h4 className={st.repName}>{t('landing.features.reps.delegate')}</h4>
                <p className={st.repBody}>{t('landing.features.reps.delegateBody')}</p>
              </li>
              <li className={st.repItem}>
                <div className={`${st.repArt} ${st.repTalk}`} lang="en">
                  <span className={st.face} aria-hidden="true">
                    {initialOf(edge.persona)}
                  </span>
                  <blockquote className={st.bubble}>{edge.opening}</blockquote>
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

/** «What you pay for»: the two plans in the pricing page's own words and prices. */
export function Pay() {
  const { t, f } = useT();
  const free = ['map', 'aiOrMe', 'rep'] as const;
  const pro = ['all', 'reps', 'plan', 'proof', 'shop'] as const;
  return (
    <section className={st.pay} aria-labelledby="pay-title">
      <div className={st.wrap}>
        <h2 id="pay-title" className={st.h2}>
          {t('landing.pay.title')}
        </h2>
        <div className={st.plans}>
          <article className={st.plan}>
            <h3 className={st.planName}>{t('pricing.free.name')}</h3>
            <p className={st.planPrice}>{f.currency(0)}</p>
            <ul className={st.planItems}>
              {free.map((k) => (
                <li key={k}>{t(`pricing.free.items.${k}`)}</li>
              ))}
            </ul>
            <Link href="/start" className={st.planCta}>
              {t('pricing.free.cta')}
            </Link>
          </article>
          <article className={`field ${st.plan} ${st.planPro}`} data-surface="field">
            <h3 className={st.planName}>{t('pricing.pro.name')}</h3>
            <p className={st.planPrice}>
              {f.currency(PRO_PRICES.month.usd)} <small>{t('pricing.pro.perMonth')}</small>
            </p>
            <p className={st.planAlt}>{t('pricing.pro.orYear', { price: f.currency(PRO_PRICES.year.usd) })}</p>
            <ul className={st.planItems}>
              {pro.map((k) => (
                <li key={k}>{t(`pricing.pro.items.${k}`)}</li>
              ))}
            </ul>
            {LANDING_LINKS.pricing ? (
              <Link href={LANDING_LINKS.pricing} className={`${st.planCta} ${st.planCtaPro}`}>
                {t('pricing.trial')}
              </Link>
            ) : null}
          </article>
        </div>
        {LANDING_LINKS.cup ? (
          <p className={st.cup}>
            {t('landing.pay.cup', { date: f.date(CUP_OFFER_UNTIL, 'long') })}{' '}
            <Link href={LANDING_LINKS.cup} className={st.paperLink}>
              {t('landing.pay.cupLink')}
            </Link>
          </p>
        ) : null}
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
