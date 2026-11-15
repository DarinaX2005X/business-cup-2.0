'use client';

import { Calculator, Laptop, Stethoscope, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/kit/Button';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { demoRequest, type DemoPersona } from '@/lib/client/auth';
import { useProfile } from '@/lib/client/profile';
import st from './band.module.css';

export const JURY_PERSONAS = ['nurse', 'software_engineer', 'accountant'] as const;
export type JuryPersona = (typeof JURY_PERSONAS)[number];

/** Button ids (and their copy keys) → the persona names of the API. */
const API_PERSONA: Record<JuryPersona, DemoPersona> = { nurse: 'nurse', software_engineer: 'software', accountant: 'accountant' };

const ICON: Record<JuryPersona, LucideIcon> = { nurse: Stethoscope, software_engineer: Laptop, accountant: Calculator };

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/**
 * Business Cup 2.0 jury: one click logs this device into a shared, ready demo account for that job
 * (POST /api/auth/demo). The account was built from a sample resume through the real pipeline and has
 * Max on; the first click for a job builds it (about 20 seconds), later clicks open it at once. The
 * visitor's own account is untouched: they can log out of the demo and log back in. A busy server (503)
 * is asked once more before the row offers the same button again.
 */
export function JuryAccounts({ surface = 'paper', size = 'compact' }: { surface?: 'paper' | 'violet'; size?: 'compact' | 'large' }) {
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
      let creds;
      try {
        creds = await demoRequest(API_PERSONA[persona]);
      } catch (err) {
        if (!(err instanceof ApiError && (err.status === 503 || err.status === 0 || err.status >= 500))) throw err;
        await wait(2500);
        creds = await demoRequest(API_PERSONA[persona]);
      }
      const ok = await prof.signIn({ id: creds.id, secret: creds.secret });
      if (!ok) throw new Error('demo profile did not load');
      router.push('/home');
    } catch {
      setBusy(null);
      setFailed(persona);
    }
  };

  if (size === 'large') {
    // /cup: the jury's way in comes first, three big buttons, no sign-up
    return (
      <div className={st.juryLarge} data-surface={surface === 'violet' ? 'field' : undefined}>
        <p className={st.juryLead}>{t('cup.jury.lead')}</p>
        <div className={st.juryStack}>
          {JURY_PERSONAS.map((p) => {
            const Icon = ICON[p];
            return (
              <Button
                key={p}
                size="lg"
                block
                variant={surface === 'violet' ? 'apricot' : 'primary'}
                icon={<Icon strokeWidth={1.9} />}
                loading={busy === p}
                loadingLabel={t('cup.jury.opening')}
                disabled={busy !== null && busy !== p}
                onClick={() => open(p)}
                className={st.juryBig}
              >
                {t(`cup.jury.open.${p}`)}
              </Button>
            );
          })}
        </div>
        <p className={st.juryState} role="status" data-error={failed ? '' : undefined}>
          {busy ? t('cup.jury.building') : failed ? t('cup.jury.failed') : t('auth.demoNote')}
        </p>
      </div>
    );
  }

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
        {busy ? t('cup.jury.building') : failed ? t('cup.jury.failed') : t('auth.demoNote')}
      </p>
    </div>
  );
}
