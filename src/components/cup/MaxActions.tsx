'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useRequireAccount } from '@/components/auth/AuthProvider';
import { Button } from '@/components/kit/Button';
import { changePlan } from '@/components/pricing/billing';
import { tierName } from '@/domain/points';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useOptionalProfile } from '@/lib/client/profile';
import { CupOffer } from './CupOffer';
import { planOf } from './plan';

/**
 * The way into Max from a locked Max feature (Playbook, Second look, Review kit, the coach): «Upgrade to
 * Max» and the Business Cup offer beside it. A paid Pro subscription switches in place and pays only the
 * difference (the portal's confirm page); anyone else gets one Max checkout. If that cannot start, the
 * plans page takes over.
 */
export function MaxActions({ onUnlocked, className }: { onUnlocked?: () => void; className?: string }) {
  const { t } = useT();
  const router = useRouter();
  const prof = useOptionalProfile();
  const requireAccount = useRequireAccount();
  const [busy, setBusy] = useState(false);
  const paidPro = planOf(prof?.profile?.plan).stripe;

  const upgrade = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await prof?.ensure();
      const res = await requireAccount(() =>
        paidPro ? changePlan('coach') : apiFetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { tier: 'coach', interval: 'year' } }),
      );
      if (!res) return setBusy(false);
      window.location.assign(res.url);
    } catch {
      setBusy(false);
      router.push('/pricing');
    }
  };

  return (
    <span className={className} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <Button variant="primary" loading={busy} loadingLabel={t('pricing.opening')} onClick={() => void upgrade()}>
        {t('pricing.tiers.upgrade', { name: tierName('coach') })}
      </Button>
      <CupOffer onUnlocked={onUnlocked} />
    </span>
  );
}
