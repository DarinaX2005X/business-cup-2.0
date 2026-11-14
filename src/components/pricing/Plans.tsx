'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CupBand } from '@/components/cup/CupBand';
import { Button } from '@/components/kit/Button';
import { Segmented } from '@/components/kit/Segmented';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { PRO_MONTHLY_USD, PRO_YEARLY_USD, type Interval } from './billing';
import st from './plans.module.css';

export type Tier = 'pro' | 'coach';

/**
 * The three plans (ROUND3, decision 5). Pro prices come from PRO_PRICES; Coach mirrors the decision
 * until the billing package exports its PLANS constant, then this table reads from it.
 */
export const TIER_PRICES: Record<Tier, { month: number; year: number }> = {
  pro: { month: PRO_MONTHLY_USD, year: PRO_YEARLY_USD },
  coach: { month: 39, year: 239 },
};

const ITEMS = {
  free: ['map', 'aiOrMe', 'rep', 'jobs', 'points'],
  pro: ['reps', 'plan', 'skills', 'jobs', 'proof', 'playbook', 'pdf', 'shop'],
  coach: ['all', 'chat', 'voice', 'checkins', 'priority'],
} as const;

const saving = (t: Tier) => 1 - TIER_PRICES[t].year / (TIER_PRICES[t].month * 12);
/** «Save up to N%»: the best yearly saving among the paid plans. */
export const MAX_SAVING = Math.max(saving('pro'), saving('coach'));

/**
 * The plans, one component for the landing and /pricing: the Monthly / Yearly toggle on top, then
 * Free, Pro (raised, «Most popular») and Coach, and the Business Cup 2.0 card under them. Yearly
 * shows the price per month after the discount and what is billed once a year. A paid button makes
 * sure a profile exists and opens Stripe Checkout for that tier; if checkout cannot start, the
 * landing sends the person to /pricing and /pricing says so next to the button.
 */
export function Plans({ freeHref = '/start', freeLabel, heading = 'h3' }: { freeHref?: string; freeLabel?: string; heading?: 'h2' | 'h3' }) {
  const { t, f } = useT();
  const prof = useProfile();
  const router = useRouter();
  const onPricing = usePathname() === '/pricing';
  const [interval, setBilling] = useState<Interval>('year');
  const [busy, setBusy] = useState<Tier | null>(null);
  const [failed, setFailed] = useState<Tier | null>(null);
  const H = heading;

  const checkout = async (tier: Tier) => {
    if (busy) return;
    setBusy(tier);
    setFailed(null);
    try {
      await prof.ensure();
      const { url } = await apiFetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { tier, interval } });
      window.location.assign(url);
    } catch {
      setBusy(null);
      if (onPricing) setFailed(tier);
      else router.push('/pricing');
    }
  };

  const price = (tier: Tier) => {
    const p = TIER_PRICES[tier];
    return interval === 'year' ? f.currency(Math.round((p.year / 12) * 100) / 100, { cents: true }) : f.currency(p.month);
  };

  const paid = (tier: Tier) => (
    <article className={st.plan} data-tier={tier} aria-labelledby={`plan-${tier}`}>
      {tier === 'pro' ? <span className={st.tag}>{t('pricing.tiers.popular')}</span> : null}
      <H id={`plan-${tier}`} className={st.name}>
        {t(`pricing.tiers.${tier}.name`)}
      </H>
      <p className={st.price} aria-live="polite">
        <b>{price(tier)}</b> <span>{t('pricing.pro.perMonth')}</span>
      </p>
      <p className={st.billed}>
        {interval === 'year' ? t('pricing.tiers.billedYear', { price: f.currency(TIER_PRICES[tier].year) }) : t('pricing.tiers.billedMonth')}
      </p>
      <p className={st.lead}>{t(`pricing.tiers.${tier}.lead`)}</p>
      <Button
        variant={tier === 'pro' ? 'apricot' : 'primary'}
        size="lg"
        block
        loading={busy === tier}
        loadingLabel={t('pricing.opening')}
        onClick={() => checkout(tier)}
      >
        {t(`pricing.tiers.${tier}.cta`)}
      </Button>
      {failed === tier ? (
        <p className={st.error} role="alert">
          {t('pricing.errors.checkout')}
        </p>
      ) : null}
      <ul className={st.items}>
        {ITEMS[tier].map((k) => (
          <li key={k}>
            <Check strokeWidth={2.4} aria-hidden="true" />
            {t(`pricing.tiers.${tier}.items.${k}`)}
          </li>
        ))}
      </ul>
    </article>
  );

  return (
    <div className={st.root}>
      <div className={st.toggle}>
        <Segmented
          label={t('pricing.interval.label')}
          value={interval}
          onChange={setBilling}
          options={[
            { value: 'month', label: t('pricing.interval.month') },
            { value: 'year', label: t('pricing.interval.year') },
          ]}
        />
        <span className={st.save} data-on={interval === 'year' || undefined}>
          {t('pricing.tiers.save', { percent: Math.round(MAX_SAVING * 100) })}
        </span>
      </div>

      <div className={st.plans}>
        <article className={st.plan} data-tier="free" aria-labelledby="plan-free">
          <H id="plan-free" className={st.name}>
            {t('pricing.tiers.free.name')}
          </H>
          <p className={st.price}>
            <b>{f.currency(0)}</b>
          </p>
          <p className={st.billed}>{t('pricing.tiers.free.billed')}</p>
          <p className={st.lead}>{t('pricing.tiers.free.lead')}</p>
          <Link href={freeHref} className={`${btn.btn} ${btn.b_secondary} ${btn.s_lg} ${btn.block}`}>
            {freeLabel ?? t('pricing.free.cta')}
          </Link>
          <ul className={st.items}>
            {ITEMS.free.map((k) => (
              <li key={k}>
                <Check strokeWidth={2.4} aria-hidden="true" />
                {t(`pricing.tiers.free.items.${k}`)}
              </li>
            ))}
          </ul>
        </article>
        {paid('pro')}
        {paid('coach')}
      </div>

      <CupBand className={st.band} />
    </div>
  );
}
