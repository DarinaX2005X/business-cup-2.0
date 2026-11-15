'use client';

import Link from 'next/link';
import { SheetStack } from '@/components/kit/Illustration';
import btn from '@/components/kit/controls.module.css';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { useAccount } from '@/components/shell/HeaderAccount';
import { useT } from '@/i18n/client';
import st from './lost.module.css';

/**
 * The root «not found» and «something went wrong» pages: the product's header, one plain sentence, a way
 * back (Home for a person with a profile, else the start page) and, for an error, «Try again».
 */
export function Lost({ kind, onRetry }: { kind: 'missing' | 'error'; onRetry?: () => void }) {
  const { t } = useT();
  const account = useAccount();
  const home = account ? '/home' : '/';
  return (
    <div className={st.page}>
      <SiteHeader />
      <main className={st.main}>
        <section className={st.card} aria-labelledby="lost-title">
          <div className={st.text}>
            <h1 id="lost-title" className={st.title}>
              {t(`shell.lost.${kind}.title`)}
            </h1>
            <p className={st.body}>{t(`shell.lost.${kind}.body`)}</p>
            <div className={st.actions}>
              {kind === 'error' && onRetry ? (
                <button type="button" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`} onClick={onRetry}>
                  {t('shell.lost.retry')}
                </button>
              ) : null}
              <Link href={home} className={`${btn.btn} ${kind === 'error' ? btn.b_secondary : btn.b_primary} ${btn.s_lg}`}>
                {account ? t('shell.lost.home') : t('shell.lost.start')}
              </Link>
            </div>
          </div>
          <SheetStack className={st.art} />
        </section>
      </main>
    </div>
  );
}
