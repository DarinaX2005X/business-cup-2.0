'use client';

import { Info, TicketPercent } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CupOffer } from '@/components/cup/CupOffer';
import { planOf, type ProfilePlan } from '@/components/cup/plan';
import { Button } from '@/components/kit/Button';
import btn from '@/components/kit/controls.module.css';
import type { Redemption } from '@/domain/types';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { openPortal, pendingProCode, syncPlan, PRO_MONTHLY_USD, PRO_YEARLY_USD, startCheckout, type Interval } from './billing';
import type { FirstWeekView } from './firstWeek';
import { FirstWeekSheet } from './FirstWeekSheet';
import { Plans } from './Plans';
import { PricingHeader } from './PricingHeader';
import st from './pricing.module.css';

export interface PricingInitial {
  plan: ProfilePlan | null;
  redemptions: Redemption[];
  lastXrayId: string | null;
}

/**
 * /pricing: Free and Pro side by side, the trial through Stripe Checkout (test mode) and the Business Cup
 * offer as the quieter second action. With `?from=<xrayId>` the page opens with the person's first week
 * of reps, built from their own map.
 */
export function PricingPage({ canceled, portal, week, initial }: { canceled: boolean; portal: boolean; week: FirstWeekView | null; initial: PricingInitial }) {
  const { t, f } = useT();
  const prof = useProfile();
  const [interval, setBilling] = useState<Interval>('year');
  const loading = prof.status === 'loading';
  const plan = planOf(loading ? initial.plan : (prof.profile?.plan as ProfilePlan | undefined));
  const lastXrayId = loading ? initial.lastXrayId : (prof.profile?.lastXrayId ?? null);
  const mapHref = lastXrayId ? `/x/${lastXrayId}` : null;

  const price = interval === 'year' ? PRO_YEARLY_USD : PRO_MONTHLY_USD;
  const priceText = f.currency(price);
  const per = interval === 'year' ? t('pricing.pro.perYear') : t('pricing.pro.perMonth');

  const plansTitle = <>{t('pricing.title')}</>;

  // Back from the Stripe Billing Portal: read the subscription again so a cancellation shows at once.
  const { refresh } = prof;
  const synced = useRef(false);
  useEffect(() => {
    if (!portal || synced.current) return;
    synced.current = true;
    syncPlan()
      .catch(() => undefined)
      .finally(() => void refresh());
  }, [portal, refresh]);

  return (
    <div className={st.page}>
      <PricingHeader mapHref={mapHref} />
      <main className={st.main}>
        {canceled ? (
          <p className={st.notice} role="status">
            <Info strokeWidth={1.75} aria-hidden="true" />
            {t('pricing.canceled')}
          </p>
        ) : null}

        {week ? (
          <section className={st.personal} aria-labelledby="week-title">
            <div className={st.personalText}>
              <h1 id="week-title" className={st.h1}>
                {t('pricing.week.title')}
              </h1>
              <p className={st.lead}>{t('pricing.week.lead', { jobTitle: week.jobTitle })}</p>
              <p className={st.move}>
                <b>{t('pricing.week.score', { score: week.score })}</b> {t('pricing.week.move')}
              </p>
              <TrialBox surface="paper" interval={interval} plan={plan} hasMap={!!lastXrayId} priceLine={t('pricing.pro.trialLine', { price: priceText, per })} />
            </div>
            <FirstWeekSheet days={week.days} labelledBy="week-title" />
          </section>
        ) : null}

        <section className={st.plans} aria-labelledby="plans-title">
          <div className={st.plansHead}>
            {week ? (
              <h2 id="plans-title" className={st.h2}>
                {plansTitle}
              </h2>
            ) : (
              <h1 id="plans-title" className={st.h1}>
                {plansTitle}
              </h1>
            )}
          </div>

          <Plans
            interval={interval}
            onInterval={setBilling}
            heading={week ? 'h3' : 'h2'}
            freeHref={mapHref ?? '/start'}
            freeLabel={mapHref ? t('pricing.free.ctaOwn') : t('pricing.free.cta')}
            action={<TrialBox surface="violet" cup={false} interval={interval} plan={plan} hasMap={!!lastXrayId} priceLine={t('pricing.pro.trialLine', { price: priceText, per })} />}
          />
        </section>
      </main>
    </div>
  );
}

/**
 * The buying part, the same wherever it appears: an issued shop code, «Start your 7-day free trial»,
 * the Business Cup offer beside it and the one line about Stripe test mode. With Pro already on it
 * says until when and offers the next step (and the Billing Portal for a Stripe subscription).
 */
export function TrialBox({
  surface,
  interval,
  plan,
  hasMap,
  priceLine,
  cup = true,
}: {
  surface: 'paper' | 'violet';
  interval: Interval;
  plan: ReturnType<typeof planOf>;
  hasMap: boolean;
  priceLine: string;
  /** The Business Cup action beside the trial button; off where the cup card is already on screen. */
  cup?: boolean;
}) {
  const { t, f } = useT();
  const prof = useProfile();
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const code = pendingProCode(prof.profile?.redemptions);
  const onViolet = surface === 'violet';

  const go = async (what: 'checkout' | 'portal') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'checkout') await prof.ensure();
      const { url } = what === 'checkout' ? await startCheckout(interval) : await openPortal();
      window.location.assign(url);
    } catch (err) {
      const c = err instanceof ApiError ? err.code : 'network';
      setError(c === 'network' ? t('common.errors.network') : what === 'checkout' ? t('pricing.errors.checkout') : t('pricing.errors.portal'));
      setBusy(null);
    }
  };

  const next = (
    <Link href={hasMap ? '/today' : '/start'} className={`${btn.btn} ${onViolet ? btn.b_apricot : btn.b_primary}`}>
      {hasMap ? t('pricing.startRep') : t('pricing.mapFirst')}
    </Link>
  );

  let body: ReactNode;
  if (plan.active) {
    const date = plan.periodEnd ? f.date(plan.periodEnd, 'long') : '';
    body = (
      <>
        <p className={st.status} role="status">
          {t(`pricing.status.${plan.kind}`, { date })}
        </p>
        <div className={st.actions}>
          {next}
          {plan.stripe ? (
            <Button variant={onViolet ? 'ghost' : 'secondary'} loading={busy === 'portal'} loadingLabel={t('pricing.portalOpening')} onClick={() => go('portal')}>
              {t('pricing.portal')}
            </Button>
          ) : null}
        </div>
      </>
    );
  } else {
    body = (
      <>
        {code ? (
          <p className={st.codePlate}>
            <TicketPercent strokeWidth={1.75} aria-hidden="true" />
            {'percent' in code ? t('pricing.code.percent', { percent: code.percent }) : t('pricing.code.months', { count: code.months })}
          </p>
        ) : null}
        <div className={st.actions}>
          <Button variant={onViolet ? 'apricot' : 'primary'} size="lg" loading={busy === 'checkout'} loadingLabel={t('pricing.opening')} onClick={() => go('checkout')}>
            {t('pricing.trial')}
          </Button>
          {cup ? <CupOffer surface={surface} /> : null}
        </div>
        <p className={st.priceLine}>{priceLine}</p>
        <p className={st.testLine}>{t('pricing.testMode')}</p>
      </>
    );
  }

  return (
    <div className={st.trialBox} data-surface={onViolet ? 'field' : undefined}>
      {body}
      {error ? (
        <p className={st.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
