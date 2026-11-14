'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CupBand } from '@/components/cup/CupBand';
import { Button } from '@/components/kit/Button';
import { Segmented } from '@/components/kit/Segmented';
import btn from '@/components/kit/controls.module.css';
import { PLANS, type PlanOffer } from '@/domain/points';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import type { Interval } from './billing';
import st from './plans.module.css';

/**
 * The top tier is called Max and costs $79 a month or $479 a year (user decision). The domain
 * constant is being renamed from `coach`; while it still carries the old id, the name and prices
 * are taken from here, and once it says `max` everything is read from PLANS.
 */
const MAX_UNTIL_RENAMED = { name: 'Max', month: 79, year: 479 };

interface Shown {
  id: PlanOffer['id'];
  name: string;
  tagline: string;
  badge: string | null;
  price: { month: number; perMonthYearly: number; year: number; save: number } | null;
  includes: PlanOffer['includes'];
  features: string[];
  top: boolean;
}

function shownPlans(): Shown[] {
  const paid = PLANS.filter((p) => p.price);
  const topId = paid[paid.length - 1]?.id;
  return PLANS.map((p) => {
    const top = p.id === topId;
    const stale = top && (p.id as string) === 'coach';
    const month = stale ? MAX_UNTIL_RENAMED.month : p.price?.month;
    const year = stale ? MAX_UNTIL_RENAMED.year : p.price?.year;
    return {
      id: p.id,
      name: stale ? MAX_UNTIL_RENAMED.name : p.name,
      tagline: p.tagline,
      badge: p.badge,
      price: month && year ? { month, year, perMonthYearly: Math.round((year / 12) * 100) / 100, save: Math.round((1 - year / (month * 12)) * 100) } : null,
      includes: p.includes,
      features: p.features.map((f) => f.text.replace(/résumé/g, 'resume')),
      top,
    };
  });
}

/**
 * The plans, one component for the landing and /pricing: the Monthly / Yearly toggle on top, then
 * Free, Pro (raised, «Most popular») and Max, and the Business Cup 2.0 card under them. Names,
 * prices and feature lists come from PLANS in the domain. Yearly shows the price per month after the
 * discount and what is billed once a year. A paid button makes sure a profile exists and opens Stripe
 * Checkout for that tier; if checkout cannot start, the landing sends the person to /pricing and
 * /pricing says so next to the button.
 */
export function Plans({ freeHref = '/start', freeLabel, heading = 'h3' }: { freeHref?: string; freeLabel?: string; heading?: 'h2' | 'h3' }) {
  const { t, f } = useT();
  const prof = useProfile();
  const router = useRouter();
  const onPricing = usePathname() === '/pricing';
  const [interval, setBilling] = useState<Interval>('year');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const H = heading;
  const plans = shownPlans();
  const saveUpTo = Math.max(0, ...plans.map((p) => p.price?.save ?? 0));

  const checkout = async (tier: string) => {
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
          {t('pricing.tiers.save', { percent: saveUpTo })}
        </span>
      </div>

      <div className={st.plans}>
        {plans.map((p) => {
          const kind = !p.price ? 'free' : p.top ? 'top' : 'pro';
          const features = p.top ? [t('pricing.tiers.top.first'), ...p.features.slice(1)] : p.features;
          return (
            <article key={p.id} className={st.plan} data-tier={kind} aria-labelledby={`plan-${p.id}`}>
              {p.badge ? <span className={st.tag}>{p.badge}</span> : null}
              <H id={`plan-${p.id}`} className={st.name}>
                {p.name}
              </H>
              <p className={st.price} aria-live="polite">
                <b>{p.price ? (interval === 'year' ? f.currency(p.price.perMonthYearly, { cents: true }) : f.currency(p.price.month)) : f.currency(0)}</b>
                {p.price ? <span>{t('pricing.pro.perMonth')}</span> : null}
              </p>
              <p className={st.billed}>
                {!p.price ? t('pricing.tiers.free.billed') : interval === 'year' ? t('pricing.tiers.billedYear', { price: f.currency(p.price.year) }) : t('pricing.tiers.billedMonth')}
              </p>
              <p className={st.lead}>{p.tagline}</p>
              {p.price ? (
                <Button variant={kind === 'pro' ? 'apricot' : 'primary'} size="lg" block loading={busy === p.id} loadingLabel={t('pricing.opening')} onClick={() => checkout(p.id)}>
                  {kind === 'pro' ? t('pricing.trial') : t('pricing.tiers.top.cta')}
                </Button>
              ) : (
                <Link href={freeHref} className={`${btn.btn} ${btn.b_secondary} ${btn.s_lg} ${btn.block}`}>
                  {freeLabel ?? t('pricing.tiers.free.cta')}
                </Link>
              )}
              {failed === p.id ? (
                <p className={st.error} role="alert">
                  {t('pricing.errors.checkout')}
                </p>
              ) : null}
              <ul className={st.items}>
                {p.includes ? (
                  <li>
                    <Check strokeWidth={2.4} aria-hidden="true" />
                    <b>{t(`pricing.tiers.includes.${p.includes}`)}</b>
                  </li>
                ) : null}
                {features.map((text) => (
                  <li key={text}>
                    <Check strokeWidth={2.4} aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <CupBand className={st.band} />
    </div>
  );
}
