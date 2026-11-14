'use client';

import Link from 'next/link';
import btn from '@/components/kit/controls.module.css';
import { HeaderAccount, LoginButton, useAccount } from '@/components/shell/HeaderAccount';
import { useT } from '@/i18n/client';
import st from './returning.module.css';

/**
 * For the landing: a person who already has a week map sees «Open my week» instead of the job form,
 * and their account on the right of the landing nav. A guest sees the landing exactly as built.
 */

/** The landing nav's right side: Log in for a new visitor, points, level and the account (or Log in and Save my progress) once a profile exists. */
export function LandingAccount() {
  const account = useAccount();
  if (account === undefined) return null;
  if (account === null) {
    return (
      <div className={st.navAccount}>
        <LoginButton surface="field" />
      </div>
    );
  }
  return (
    <div className={st.navAccount}>
      <HeaderAccount snapshot={account} surface="field" parts={{ streak: false }} />
    </div>
  );
}

/** «Open my week» in place of the job form, on the violet field or on paper. */
export function OpenMyWeek({ surface }: { surface: 'field' | 'paper' }) {
  const { t } = useT();
  const account = useAccount();
  const job = account?.jobTitle;
  return (
    <div className={st.open} data-surface={surface}>
      <Link href="/home" className={`${btn.btn} ${surface === 'field' ? btn.b_lavender : btn.b_primary} ${btn.s_lg}`}>
        {t('shell.openWeek')}
      </Link>
      <p className={st.lead}>
        {job ? t('shell.returning.lead', { job }) : t('shell.returning.leadNoJob')}{' '}
        <Link href="/today" className={st.link}>
          {t('shell.returning.today')}
        </Link>
      </p>
    </div>
  );
}

/** True once the live profile has a week map (never during the first paint, so guests see no flash). */
export function useHasWeek(): boolean {
  const account = useAccount();
  return !!account?.lastXrayId;
}
