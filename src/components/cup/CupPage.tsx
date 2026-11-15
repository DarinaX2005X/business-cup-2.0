'use client';

import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/kit/Button';
import { FieldArches } from '@/components/kit/Illustration';
import btn from '@/components/kit/controls.module.css';
import { MarketingHeader } from '@/components/public/MarketingHeader';
import { useT } from '@/i18n/client';
import { CupNext, CupPass } from './CupOffer';
import { JuryAccounts } from './JuryAccounts';
import { Trophy } from './Trophy';
import type { ProfilePlan } from './plan';
import { useCupUnlock } from './useCupUnlock';
import st from './cup.module.css';

/**
 * /cup: the Business Cup 2.0 page on the violet field. The jury's three demo accounts come first, right
 * under the title: one click, Max on, no sign-up. Under a quiet divider, «Want Max on your own account?»
 * with Unlock Max (which asks to sign in or sign up first) and the honest date; it turns into the next
 * step once Max is on, and the pass on the right gets its stamp at the same moment.
 */
export function CupPage({ initialPlan, hasMap }: { initialPlan: ProfilePlan | null; hasMap: boolean }) {
  const { t } = useT();
  const cup = useCupUnlock({ initialPlan, hasMapInitial: hasMap });
  const on = cup.phase === 'done' || (cup.plan.kind === 'cup' && cup.plan.active);
  const already = !on && cup.alreadyPro;
  const ended = !on && !already && !cup.offerOpen;
  const offer = !on && !already && !ended;

  return (
    <div className={`${st.page} field`} data-surface="field">
      <FieldArches className={st.arches} />
      {/* a page of its own: only the logo and Log in / the account, no site tabs */}
      <MarketingHeader current="cup" surface="field" minimal />

      <main className={st.main}>
        <div className={st.text}>
          <h1 className={st.title}>
            <span>{t('cup.titleA')}</span>
            <span>{t('cup.titleB')}</span>
          </h1>

          {/* first: the jury's shared demo accounts, whatever this visitor's own plan is */}
          <JuryAccounts surface="violet" size="large" />

          {/* then, quieter: Max on the visitor's own account */}
          <section className={st.own} aria-labelledby={offer ? 'cup-own-title' : undefined}>
            {offer ? (
              <h2 id="cup-own-title" className={st.ownTitle}>
                {t('cup.own.title')}
              </h2>
            ) : null}
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
                  <Button variant="lavender" size="lg" loading={cup.phase === 'busy'} loadingLabel={t('cup.unlocking')} onClick={cup.unlock}>
                    {t('cup.unlock')}
                  </Button>
                </div>
              </>
            )}
          </section>

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
