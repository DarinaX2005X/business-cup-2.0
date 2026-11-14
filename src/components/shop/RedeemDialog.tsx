'use client';

import { useState } from 'react';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import { Dialog } from '@/components/kit/Overlay';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { redeemWhat } from './names';
import type { RedeemResult, Reward } from './types';
import st from './shop.module.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Redeem 250 points for 10% off your first payment?»: the cost, what happens next and the balance left,
 * before anything is spent. Partner gifts ask where to send the code. Errors stay in the dialog with the
 * points untouched.
 */
export function RedeemDialog({
  reward,
  balance,
  subscribed,
  lastEmail,
  onClose,
  run,
  onRedeemed,
}: {
  reward: Reward;
  balance: number;
  subscribed: boolean;
  lastEmail: string | null;
  onClose: () => void;
  run: (rewardId: string, email: string | undefined, requestId: string) => Promise<RedeemResult>;
  onRedeemed: (r: RedeemResult) => void;
}) {
  const { t, f } = useT();
  const cost = reward.cost ?? 0;
  const partner = reward.kind === 'partner_gift';
  const [email, setEmail] = useState(lastEmail ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per dialog: a double press or a retry after a dropped answer returns the same redemption.
  const [requestId] = useState(() => `rd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

  const explain = (() => {
    switch (reward.kind) {
      case 'pro_discount':
        return subscribed ? t('shop.redeem.explain.discountSub') : t('shop.redeem.explain.discount');
      case 'pro_months':
        return subscribed ? t('shop.redeem.explain.monthsSub', { count: reward.months ?? 1 }) : t('shop.redeem.explain.months');
      case 'partner_gift':
        return t('shop.redeem.explain.gift');
      case 'streak_freeze':
        return t('shop.redeem.explain.freeze');
      default:
        return '';
    }
  })();

  const submit = async () => {
    if (busy) return;
    if (partner && !EMAIL.test(email.trim())) {
      setEmailError(t('shop.redeem.emailError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await run(reward.id, partner ? email.trim() : undefined, requestId);
      onRedeemed(res);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const status = err instanceof ApiError ? err.status : 0;
      if (code === 'not_enough_points' || status === 402) setError(t('shop.errors.not_enough_points'));
      else if (code === 'discount_pending') setError(t('shop.errors.one_code'));
      else if (code === 'freeze_limit') setError(t('shop.errors.freeze_limit'));
      else if (partner && (code === 'email_required' || code === 'invalid_input')) setEmailError(t('shop.redeem.emailError'));
      else if (code === 'network') setError(t('shop.errors.network'));
      else if (code === 'payment_provider_error' || code === 'billing_unavailable') setError(t('shop.errors.stripe'));
      else setError(t('shop.errors.failed'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t('shop.redeem.title', { cost: f.number(cost), what: redeemWhat(t, reward, subscribed) })}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </Button>
          <Button data-autofocus={partner ? undefined : ''} loading={busy} loadingLabel={t('shop.redeem.busy')} onClick={submit}>
            {t('shop.redeem.confirm', { cost: f.number(cost) })}
          </Button>
        </>
      }
    >
      <form
        className={st.dialogBody}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p>{explain}</p>
        {partner ? (
          <Field
            data-autofocus=""
            type="email"
            autoComplete="email"
            inputMode="email"
            label={t('shop.redeem.email')}
            value={email}
            error={emailError ?? undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />
        ) : null}
        <p className={st.left}>{t('shop.redeem.left', { points: f.number(Math.max(0, balance - cost)) })}</p>
        {error ? (
          <p className={st.formError} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
