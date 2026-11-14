'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { planOf, type ProfilePlan } from '@/components/cup/plan';
import { Button } from '@/components/kit/Button';
import { FieldArches, SheetStack } from '@/components/kit/Illustration';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { confirmCheckout } from './billing';
import st from './pricing.module.css';

type State = { phase: 'confirming' } | { phase: 'done'; plan: ProfilePlan } | { phase: 'error'; code: string } | { phase: 'missing' };

/**
 * /pro/success: Stripe sends the person back here with the Checkout session. We confirm it on the
 * server, refresh the profile so the header changes at once, and show what is now open.
 */
export function SuccessScreen({ sessionId }: { sessionId: string | null }) {
  const { t, f } = useT();
  const prof = useProfile();
  const [state, setState] = useState<State>(sessionId ? { phase: 'confirming' } : { phase: 'missing' });
  const ran = useRef<string | null>(null);
  const refresh = prof.refresh;

  const confirm = useCallback(async () => {
    if (!sessionId) return;
    setState({ phase: 'confirming' });
    // 409 checkout_open: Stripe is still finishing the payment, so wait a moment and ask again.
    for (let attempt = 0; ; attempt++) {
      try {
        const { plan } = await confirmCheckout(sessionId);
        setState({ phase: 'done', plan });
        void refresh();
        return;
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'network';
        if (code === 'checkout_open' && attempt < 4) {
          await new Promise((r) => window.setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        setState({ phase: 'error', code });
        return;
      }
    }
  }, [sessionId, refresh]);

  useEffect(() => {
    if (!sessionId || ran.current === sessionId) return;
    ran.current = sessionId;
    void confirm();
  }, [sessionId, confirm]);

  if (state.phase === 'missing' || state.phase === 'error') {
    return (
      <div className={st.success}>
        <section className={st.pending} aria-labelledby="success-title">
          <h1 id="success-title" className={st.h2}>
            {state.phase === 'missing' ? t('pricing.success.missingTitle') : t('pricing.success.errorTitle')}
          </h1>
          <p className={st.lead} role={state.phase === 'error' ? 'alert' : undefined}>
            {state.phase === 'missing' ? t('pricing.success.missing') : state.code === 'network' ? t('common.errors.network') : t('pricing.success.error')}
          </p>
          <div className={st.actions}>
            {state.phase === 'error' ? <Button onClick={confirm}>{t('common.actions.retry')}</Button> : null}
            <Link href="/pricing" className={`${btn.btn} ${state.phase === 'error' ? btn.b_secondary : btn.b_primary}`}>
              {t('pricing.success.backToPricing')}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (state.phase === 'confirming') {
    return (
      <div className={st.success}>
        <section className={st.pending} aria-busy="true">
          <p className={st.pendingLine} role="status">
            <span className={st.spin} aria-hidden="true" />
            {t('pricing.success.confirming')}
          </p>
        </section>
      </div>
    );
  }

  const view = planOf(state.plan);
  const date = view.periodEnd ? f.date(view.periodEnd, 'long') : '';
  const hasMap = !!prof.profile?.lastXrayId;
  const mapHref = prof.profile?.lastXrayId ? `/x/${prof.profile.lastXrayId}` : '/start';
  const open: { key: string; href: string | null }[] = [
    { key: 'reps', href: hasMap ? '/today' : null },
    { key: 'plan', href: hasMap ? `${mapHref}#plan-title` : null },
    { key: 'jobs', href: hasMap ? mapHref : null },
    { key: 'proof', href: null },
    { key: 'shop', href: '/shop' },
  ];

  return (
    <div className={st.success}>
      <section className={`${st.done} field`} data-surface="field" aria-labelledby="success-title">
        <FieldArches className={st.doneArches} />
        <div className={st.doneText}>
          <h1 id="success-title" className={st.doneTitle}>
            {view.kind === 'trialing' ? t('pricing.success.titleTrial', { date }) : t('pricing.success.titlePro', { date })}
          </h1>
          <p className={st.doneLead}>{t('pricing.success.lead')}</p>
          <Link href={hasMap ? '/today' : '/start'} className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
            {hasMap ? t('pricing.startRep') : t('pricing.mapFirst')}
          </Link>
        </div>
        <div className={st.doneArt} aria-hidden="true">
          <SheetStack fit="contain" />
        </div>
      </section>

      <section className={st.opened} aria-labelledby="open-title">
        <h2 id="open-title" className={st.h2}>
          {t('pricing.success.openTitle')}
        </h2>
        <ul className={st.openList}>
          {open.map((o) => {
            const inner = (
              <>
                <b>{t(`pricing.success.open.${o.key}.name`)}</b>
                <span>{t(`pricing.success.open.${o.key}.what`)}</span>
              </>
            );
            return <li key={o.key}>{o.href ? <Link href={o.href}>{inner}</Link> : <div>{inner}</div>}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
