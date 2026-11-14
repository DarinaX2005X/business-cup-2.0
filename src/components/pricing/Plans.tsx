'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CupBand } from '@/components/cup/CupBand';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { PRO_MONTHLY_USD, PRO_YEARLY_USD, YEARLY_SAVING_USD, type Interval } from './billing';
import st from './plans.module.css';

const FREE_ITEMS = ['map', 'aiOrMe', 'rep', 'jobs'] as const;
const PRO_ITEMS = ['all', 'reps', 'plan', 'jobs', 'proof', 'shop'] as const;

/**
 * The plans, the same on the landing and on /pricing: Pro on the left with its two ways to pay
 * (yearly shown per month with what it saves, or monthly), Free on the right, and the Business Cup
 * 2.0 card under both. Prices come from PRO_PRICES. `action` is what sits under the Pro price:
 * the trial box on /pricing, a link to it on the landing.
 */
export function Plans({
  interval,
  onInterval,
  action,
  freeHref,
  freeLabel,
  heading = 'h3',
}: {
  interval: Interval;
  onInterval: (i: Interval) => void;
  action: ReactNode;
  freeHref: string;
  freeLabel: string;
  heading?: 'h3' | 'h2';
}) {
  const { t, f } = useT();
  const H = heading;
  const perMonthYearly = Math.round((PRO_YEARLY_USD / 12) * 100) / 100;
  const options: { id: Interval; name: string; price: string; note: string; tag?: string }[] = [
    {
      id: 'year',
      name: t('pricing.interval.year'),
      price: f.currency(perMonthYearly, { cents: true }),
      note: t('pricing.pro.billedYear', { price: f.currency(PRO_YEARLY_USD), amount: f.currency(YEARLY_SAVING_USD) }),
      tag: t('pricing.pro.best'),
    },
    { id: 'month', name: t('pricing.interval.month'), price: f.currency(PRO_MONTHLY_USD), note: t('pricing.pro.billedMonth') },
  ];

  return (
    <div className={st.plans}>
      <article className={`${st.pro} field`} data-surface="field" aria-labelledby="plan-pro">
        <span className={st.proTile} aria-hidden="true" />
        <div className={st.proBuy}>
          <H id="plan-pro" className={st.name}>
            {t('pricing.pro.name')}
          </H>
          <div className={st.options} role="radiogroup" aria-label={t('pricing.interval.label')}>
            {options.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={interval === o.id} className={st.option} onClick={() => onInterval(o.id)}>
                <span className={st.dot} aria-hidden="true" />
                <span className={st.optName}>
                  {o.name}
                  {o.tag ? <em>{o.tag}</em> : null}
                </span>
                <span className={st.optPrice}>
                  <b>{o.price}</b> {t('pricing.pro.perMonth')}
                </span>
                <span className={st.optNote}>{o.note}</span>
              </button>
            ))}
          </div>
          <div className={st.action}>{action}</div>
        </div>
        <ul className={st.items}>
          {PRO_ITEMS.map((k) => (
            <li key={k}>
              <Check strokeWidth={2.4} aria-hidden="true" />
              {t(`pricing.pro.items.${k}`)}
            </li>
          ))}
        </ul>
      </article>

      <article className={st.free} aria-labelledby="plan-free">
        <H id="plan-free" className={st.name}>
          {t('pricing.free.name')}
        </H>
        <p className={st.freePrice}>{f.currency(0)}</p>
        <p className={st.freeLead}>{t('pricing.free.lead')}</p>
        <ul className={st.items}>
          {FREE_ITEMS.map((k) => (
            <li key={k}>
              <Check strokeWidth={2.4} aria-hidden="true" />
              {t(`pricing.free.items.${k}`)}
            </li>
          ))}
        </ul>
        <Link href={freeHref} className={`${btn.btn} ${btn.b_secondary} ${st.freeCta}`}>
          {freeLabel}
        </Link>
      </article>

      <CupBand className={st.band} />
    </div>
  );
}
