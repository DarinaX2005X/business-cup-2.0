'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/kit/Button';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import st from './band.module.css';

export const JURY_PERSONAS = ['nurse', 'software_engineer', 'accountant'] as const;
export type JuryPersona = (typeof JURY_PERSONAS)[number];

/**
 * Business Cup 2.0 jury: one click opens a ready account. The click makes sure a profile exists, asks
 * the server to build the week of that sample resume through the real pipeline (POST /api/demo/jury),
 * and then goes to /home. While the week is being built the row says so; a failure keeps the choice
 * and offers the same button again.
 */
export function JuryAccounts({ surface = 'paper' }: { surface?: 'paper' | 'violet' }) {
  const { t } = useT();
  const prof = useProfile();
  const router = useRouter();
  const [busy, setBusy] = useState<JuryPersona | null>(null);
  const [failed, setFailed] = useState<JuryPersona | null>(null);

  const open = async (persona: JuryPersona) => {
    if (busy) return;
    setBusy(persona);
    setFailed(null);
    try {
      await prof.ensure();
      await apiFetch('/api/demo/jury', { method: 'POST', body: { persona } });
      await prof.refresh().catch(() => undefined);
      router.push('/home');
    } catch {
      setBusy(null);
      setFailed(persona);
    }
  };

  return (
    <div className={st.jury} data-surface={surface === 'violet' ? 'field' : undefined}>
      <p className={st.juryTitle}>{t('cup.jury.title')}</p>
      <div className={st.juryRow}>
        {JURY_PERSONAS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={surface === 'violet' ? 'lavender' : 'secondary'}
            loading={busy === p}
            loadingLabel={t('cup.jury.opening')}
            disabled={busy !== null && busy !== p}
            onClick={() => open(p)}
          >
            {failed === p ? t('cup.jury.retry', { who: t(`cup.jury.${p}`) }) : t(`cup.jury.${p}`)}
          </Button>
        ))}
      </div>
      <p className={st.juryState} role="status" data-error={failed ? '' : undefined}>
        {busy ? t('cup.jury.building') : failed ? t('cup.jury.failed') : t('cup.jury.note')}
      </p>
    </div>
  );
}
