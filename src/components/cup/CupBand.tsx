'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { JuryAccounts } from './JuryAccounts';
import { CUP_OFFER_UNTIL, cupOfferOpen } from './plan';
import { Trophy } from './Trophy';
import st from './band.module.css';

const noop = () => () => {};

/**
 * The Business Cup 2.0 card under the plans, on the landing and on /pricing: the trophy, the honest
 * date, «Unlock Max» (opens /cup) and the jury's one-click accounts. Not drawn once the offer ended.
 */
export function CupBand({ className }: { className?: string }) {
  const { t, f } = useT();
  const open = useSyncExternalStore(
    noop,
    () => cupOfferOpen(),
    () => true,
  );
  if (!open) return null;
  return (
    <aside className={`${st.band} ${className ?? ''}`} data-cup-hover="" aria-labelledby="cup-band-title">
      <Trophy size={150} className={st.cup} />
      <div className={st.text}>
        <h3 id="cup-band-title" className={st.title}>
          {t('cup.band.title', { date: f.date(CUP_OFFER_UNTIL, 'long') })}
        </h3>
        <p className={st.body}>{t('cup.band.body')}</p>
      </div>
      <Link href="/cup" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg} ${st.cta}`}>
        {t('cup.unlock')}
      </Link>
      <JuryAccounts />
    </aside>
  );
}
