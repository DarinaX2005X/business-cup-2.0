'use client';

import Link from 'next/link';
import btn from '@/components/kit/controls.module.css';
import { LoginButton, useAccount } from '@/components/shell/HeaderAccount';
import { useT } from '@/i18n/client';
import st from './returning.module.css';

/**
 * The landing nav's right side. A new visitor sees «Log in». A person with an account, or a guest who
 * already has a week map, gets «Open the app» (their Home); a guest keeps «Log in» beside it. The hero
 * always shows the job form, whoever is looking.
 */
export function LandingAccount() {
  const { t } = useT();
  const account = useAccount();
  if (account === undefined) return null;
  const signedIn = !!account?.email;
  const canOpen = signedIn || !!account?.lastXrayId;
  return (
    <div className={st.navAccount}>
      {!signedIn ? <LoginButton surface="field" /> : null}
      {canOpen ? (
        <Link href="/home" className={`${btn.btn} ${btn.b_lavender} ${btn.s_sm}`}>
          {t('shell.openApp')}
        </Link>
      ) : null}
    </div>
  );
}
