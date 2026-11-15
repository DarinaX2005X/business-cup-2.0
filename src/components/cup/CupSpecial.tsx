'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { JuryAccounts } from './JuryAccounts';
import { CUP_OFFER_UNTIL, cupOfferOpen } from './plan';
import { Trophy } from './Trophy';
import st from './special.module.css';

const noop = () => () => {};

/**
 * The Business Cup 2.0 offer as one crafted card, in two sizes that share the design:
 * - `hero`: on the landing, right under the first screen, in the same violet field, with the trophy
 *   standing out of the card, «Get Max free» and the jury's line, both to /cup;
 * - `compact`: under the plans (landing and /pricing), the same card smaller, with the jury's one-click
 *   demo accounts in place of the line.
 * Nothing is drawn once the offer has ended.
 */
export function CupSpecial({ variant, className, headingLevel = 'h2' }: { variant: 'hero' | 'compact'; className?: string; headingLevel?: 'h2' | 'h3' }) {
  const { t, f } = useT();
  const open = useSyncExternalStore(
    noop,
    () => cupOfferOpen(),
    () => true,
  );
  if (!open) return null;
  const H = headingLevel;
  const date = f.date(`${CUP_OFFER_UNTIL}T12:00:00Z`, 'long');
  const id = `cup-special-${variant}`;
  return (
    <aside className={`${st.card} ${className ?? ''}`} data-variant={variant} data-cup-hover="" aria-labelledby={id}>
      <span className={st.hatch} aria-hidden="true" />
      <span className={st.glow} aria-hidden="true" />
      <div className={st.art}>
        <Trophy size={variant === 'hero' ? 190 : 120} pieces={variant === 'hero'} className={st.trophy} />
      </div>
      <div className={st.text}>
        <H id={id} className={st.title}>
          <span className={st.kicker}>{t('cup.special.kicker')}</span> <span className={st.line}>{t('cup.special.line', { date })}</span>
        </H>
        <p className={st.body}>{t('cup.special.body')}</p>
        <div className={st.actions}>
          <Link href="/cup" className={`${btn.btn} ${btn.b_apricot} ${variant === 'hero' ? btn.s_lg : btn.s_md} ${st.cta}`}>
            {t('cup.special.cta')}
          </Link>
          {variant === 'hero' ? (
            <Link href="/cup" className={st.jury}>
              {t('cup.special.jury')}
            </Link>
          ) : null}
        </div>
      </div>
      {variant === 'compact' ? (
        <div className={st.juryRow}>
          <JuryAccounts surface="violet" />
        </div>
      ) : null}
    </aside>
  );
}
