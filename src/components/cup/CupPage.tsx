'use client';

import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/kit/Button';
import { FieldArches } from '@/components/kit/Illustration';
import { Wordmark } from '@/components/kit/Mark';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { CupNext, CupPass } from './CupOffer';
import { JuryAccounts } from './JuryAccounts';
import { Trophy } from './Trophy';
import type { ProfilePlan } from './plan';
import { useCupUnlock } from './useCupUnlock';
import st from './cup.module.css';

/**
 * /cup: the Business Cup 2.0 offer as its own page on the violet field. One action, Unlock Pro, which
 * turns into the next step once Pro is on. The pass on the right gets its stamp at the same moment.
 */
export function CupPage({ initialPlan, hasMap }: { initialPlan: ProfilePlan | null; hasMap: boolean }) {
  const { t } = useT();
  const cup = useCupUnlock({ initialPlan, hasMapInitial: hasMap });
  const on = cup.phase === 'done' || (cup.plan.kind === 'cup' && cup.plan.active);
  const already = !on && cup.alreadyPro;
  const ended = !on && !already && !cup.offerOpen;

  return (
    <div className={`${st.page} field`} data-surface="field">
      <FieldArches className={st.arches} />
      <header className={st.head}>
        <Link href="/" aria-label={t('cup.nav.home')}>
          <Wordmark size={34} tone="violet" />
        </Link>
        <nav className={st.headLinks} aria-label={t('cup.nav.label')}>
          <Link href="/pricing" className={st.headLink} data-wide="">
            {t('cup.nav.pricing')}
          </Link>
        </nav>
      </header>

      <main className={st.main}>
        <div className={st.text}>
          <h1 className={st.title}>
            <span>{t('cup.titleA')}</span>
            <span>{t('cup.titleB')}</span>
          </h1>

          {on ? (
            <>
              <p className={st.onLine} role="status">
                {t('cup.on', { date: cup.runsUntil ?? '' })}
              </p>
              <div className={st.cta}>
                <CupNext hasMap={cup.hasMap} variant="apricot" size="lg" />
              </div>
            </>
          ) : already ? (
            <>
              <p className={st.onLine}>{t('cup.alreadyTitle')}</p>
              <p className={st.lead}>{cup.plan.kind === 'trialing' ? t('cup.alreadyTrial', { date: cup.runsUntil ?? '' }) : t('cup.alreadyPro', { date: cup.runsUntil ?? '' })}</p>
              <div className={st.cta}>
                <CupNext hasMap={cup.hasMap} variant="apricot" size="lg" />
              </div>
            </>
          ) : ended ? (
            <>
              <p className={st.lead}>{t('cup.errors.offer_ended', { date: cup.until })}</p>
              <div className={st.cta}>
                <Link href="/pricing" className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
                  {t('cup.nav.pricing')}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className={st.lead}>{t('cup.lead')}</p>
              <p className={st.until}>
                <CalendarClock strokeWidth={1.75} aria-hidden="true" />
                {t('cup.until', { date: cup.until })}
              </p>
              <p className={st.scope}>{t('cup.scope')}</p>
              {cup.errorText ? (
                <p className={st.error} role="alert">
                  {cup.errorText}
                </p>
              ) : null}
              <div className={st.cta}>
                <Button variant="apricot" size="lg" loading={cup.phase === 'busy'} loadingLabel={t('cup.unlocking')} onClick={cup.unlock}>
                  {t('cup.unlock')}
                </Button>
              </div>
            </>
          )}

          {on || already ? null : <JuryAccounts surface="violet" />}

          <p className={st.foot}>
            {t('cup.footA')} <Link href="/pricing">{t('cup.footLink')}</Link>
          </p>
        </div>

        <div className={st.stage} data-cup-hover="">
          <CupPass on={on} runsUntil={cup.runsUntilShort} />
          <Trophy size={300} pieces className={st.stageCup} />
        </div>
      </main>
    </div>
  );
}
