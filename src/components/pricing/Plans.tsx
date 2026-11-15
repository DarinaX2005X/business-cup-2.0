'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useRequireAccount } from '@/components/auth/AuthProvider';
import { CupBand } from '@/components/cup/CupBand';
import { Button } from '@/components/kit/Button';
import { Segmented } from '@/components/kit/Segmented';
import btn from '@/components/kit/controls.module.css';
import { planOf } from '@/components/cup/plan';
import { CUP_OFFER_UNTIL, PLANS, tierName, tierOf, type PlanOffer, type Tier } from '@/domain/points';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { changePlan, type Interval } from './billing';
import st from './plans.module.css';

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
  return PLANS.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    badge: p.badge,
    price: p.price ? { month: p.price.month, year: p.price.year, perMonthYearly: Math.round((p.price.year / 12) * 100) / 100, save: Math.round((1 - p.price.year / (p.price.month * 12)) * 100) } : null,
    includes: p.includes,
    features: p.features.map((f) => f.text.replace(/résumé/g, 'resume')),
    top: p.id === topId,
  }));
}

/**
 * The plans, one component for the landing and /pricing: the Monthly / Yearly toggle on top, then
 * Free, Pro (raised, «Most popular») and Max, and the Business Cup 2.0 card under them. Names,
 * prices and feature lists come from PLANS in the domain. Yearly shows the price per month after the
 * discount and what is billed once a year. A paid button makes sure a profile exists and opens Stripe
 * Checkout for that tier; if checkout cannot start, the landing sends the person to /pricing and
 * /pricing says so next to the button.
 *
 * The cards know the person's plan: the active one says «Current plan», and a subscriber never gets a
 * second Checkout. On Max (paid or Business Cup) Max says «You have Max» and Pro offers the switch at
 * renewal (Stripe only); on paid Pro, Max offers the upgrade for the difference. Both changes go through
 * the Billing Portal's confirm page for the running subscription (POST /api/billing/change).
 */
export function Plans({ freeHref = '/start', freeLabel, heading = 'h3', cupBand = true }: { freeHref?: string; freeLabel?: string; heading?: 'h2' | 'h3'; cupBand?: boolean }) {
  const { t, f } = useT();
  const prof = useProfile();
  const requireAccount = useRequireAccount();
  const router = useRouter();
  const onPricing = usePathname() === '/pricing';
  const [interval, setBilling] = useState<Interval>('year');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; what: 'checkout' | 'change' } | null>(null);
  const H = heading;
  const plans = shownPlans();
  const saveUpTo = Math.max(0, ...plans.map((p) => p.price?.save ?? 0));

  // The person's plan right now: null while there is no profile, else free, pro or coach (Max).
  const profilePlan = prof.profile?.plan ?? null;
  const view = planOf(profilePlan);
  const current: 'free' | Tier | null = !prof.profile ? null : view.active && profilePlan ? tierOf(profilePlan) : 'free';
  const cupUntil = f.date(`${CUP_OFFER_UNTIL}T12:00:00Z`, 'long');

  const checkout = async (tier: string) => {
    if (busy) return;
    setBusy(tier);
    setFailed(null);
    try {
      await prof.ensure();
      // a subscription belongs to an account: a guest signs up (or logs in) first, then checkout continues
      const res = await requireAccount(() => apiFetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { tier, interval } }));
      if (!res) return setBusy(null);
      window.location.assign(res.url);
    } catch (err) {
      setBusy(null);
      // a subscription this page did not know about yet: reload the profile, and the cards switch over
      if (err instanceof ApiError && err.code === 'already_subscribed') return void prof.refresh();
      if (onPricing) setFailed({ id: tier, what: 'checkout' });
      else router.push('/pricing');
    }
  };

  /** Pro <-> Max on the running Stripe subscription: the portal's confirm page, never a new Checkout. */
  const change = async (tier: Tier) => {
    if (busy) return;
    setBusy(tier);
    setFailed(null);
    try {
      const { url } = await changePlan(tier);
      window.location.assign(url);
    } catch {
      setBusy(null);
      setFailed({ id: tier, what: 'change' });
    }
  };

  /** The card's action for this person: Checkout, a plan change, or a plain line when nothing is to buy. */
  const action = (p: Shown, kind: 'pro' | 'top') => {
    const tier = p.id as Tier;
    const have = (text: string) => (
      <p className={st.have}>
        <Check strokeWidth={2.4} aria-hidden="true" />
        {text}
      </p>
    );
    if (current === tier) return have(view.kind === 'cup' ? t('pricing.tiers.haveCup', { name: p.name, date: cupUntil }) : t('pricing.tiers.have', { name: p.name }));
    if (current === 'coach' && tier === 'pro') {
      // Max already includes Pro; a paid Max can step down when the period ends
      if (!view.stripe) return have(t('pricing.tiers.included', { name: tierName('coach') }));
      return (
        <Button variant="secondary" size="lg" block loading={busy === tier} loadingLabel={t('pricing.portalOpening')} onClick={() => change('pro')}>
          {t('pricing.tiers.atRenewal', { name: p.name })}
        </Button>
      );
    }
    if (current === 'pro' && tier === 'coach') {
      return (
        <>
          <Button variant="primary" size="lg" block loading={busy === tier} loadingLabel={t('pricing.portalOpening')} onClick={() => change('coach')}>
            {t('pricing.tiers.upgrade', { name: p.name })}
          </Button>
          <p className={st.note}>{t('pricing.tiers.upgradeNote')}</p>
        </>
      );
    }
    return (
      <Button variant={kind === 'pro' ? 'apricot' : 'primary'} size="lg" block loading={busy === p.id} loadingLabel={t('pricing.opening')} onClick={() => checkout(p.id)}>
        {kind === 'pro' ? t('pricing.trial') : t('pricing.tiers.top.cta')}
      </Button>
    );
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
            {
              value: 'year',
              label: t('pricing.interval.year'),
              // the saving sits inside the Yearly segment itself
              extra: (
                <span className={st.save} data-on={interval === 'year' || undefined}>
                  {t('pricing.tiers.save', { percent: saveUpTo })}
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className={st.plans}>
        {plans.map((p) => {
          const kind = !p.price ? 'free' : p.top ? 'top' : 'pro';
          const features = p.top ? [t('pricing.tiers.top.first'), ...p.features.slice(1)] : p.features;
          return (
            <article key={p.id} className={st.plan} data-tier={kind} data-current={current === p.id || undefined} aria-labelledby={`plan-${p.id}`}>
              {current === p.id ? (
                <span className={st.tag} data-current="">
                  {t('pricing.tiers.current')}
                </span>
              ) : p.badge ? (
                <span className={st.tag}>{p.badge}</span>
              ) : null}
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
                action(p, kind === 'pro' ? 'pro' : 'top')
              ) : (
                <Link href={freeHref} className={`${btn.btn} ${btn.b_secondary} ${btn.s_lg} ${btn.block}`}>
                  {freeLabel ?? t('pricing.tiers.free.cta')}
                </Link>
              )}
              {failed?.id === p.id ? (
                <p className={st.error} role="alert">
                  {failed.what === 'change' ? t('pricing.errors.change') : t('pricing.errors.checkout')}
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

      {cupBand ? <CupBand className={st.band} /> : null}
    </div>
  );
}
