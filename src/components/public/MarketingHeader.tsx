'use client';

import Link from 'next/link';
import { KeystoneMark } from '@/components/kit/Mark';
import btn from '@/components/kit/controls.module.css';
import { DemoMark, HeaderAccount, LoginButton, useAccount } from '@/components/shell/HeaderAccount';
import { useT } from '@/i18n/client';
import st from './marketing.module.css';

export type MarketingPage = 'method' | 'jobs' | 'pricing' | 'cup';

const LINKS: { id: MarketingPage; href: string }[] = [
  { id: 'method', href: '/method' },
  { id: 'jobs', href: '/jobs' },
  { id: 'pricing', href: '/#pricing' },
  { id: 'cup', href: '/cup' },
];

/**
 * The one header of the marketing pages (/method, /jobs, /pricing, /cup): the logo, the reading pages,
 * and the same right side as the app. A visitor without an account gets «Log in» and «Map my week» (or
 * «Open the app» once they have a week map); a signed-in person gets «Open the app» and the account menu.
 */
export function MarketingHeader({ current, surface = 'paper', minimal = false }: { current?: MarketingPage; surface?: 'paper' | 'field'; minimal?: boolean }) {
  const { t } = useT();
  const account = useAccount();
  if (minimal) return <MinimalHeader surface={surface} />;
  const home = account ? '/home' : '/';
  return (
    <header className={st.header} data-surface={surface} data-account={account ? '' : undefined}>
      <div className={st.inner}>
        <div className={st.left}>
          <Link href={home} className={st.brand} aria-label={account ? t('shell.home') : t('shell.homeGuest')}>
            <KeystoneMark size={32} tone={surface === 'field' ? 'violet' : 'paper'} />
            <span className={st.wordmark}>Irreplaceable</span>
          </Link>
          {account?.demo ? <DemoMark /> : null}
        </div>
        <nav className={st.nav} aria-label={t('shell.site.label')}>
          {LINKS.map((l) => (
            <Link key={l.id} href={l.href} className={st.navLink} aria-current={current === l.id ? 'page' : undefined}>
              {t(`shell.site.${l.id}`)}
            </Link>
          ))}
        </nav>
        <div className={st.right}>
          {account?.email ? (
            <>
              <Link href={account.lastXrayId ? '/home' : '/start'} className={`${btn.btn} ${surface === 'field' ? btn.b_lavender : btn.b_primary} ${btn.s_sm} ${st.cta}`}>
                {account.lastXrayId ? t('shell.openApp') : t('shell.mapOwn')}
              </Link>
              <HeaderAccount snapshot={account} surface={surface} parts={{ streak: false }} />
            </>
          ) : account !== undefined ? (
            <>
              <LoginButton surface={surface} />
              <Link href={account?.lastXrayId ? '/home' : '/start'} className={`${btn.btn} ${surface === 'field' ? btn.b_lavender : btn.b_primary} ${btn.s_sm} ${st.cta}`}>
                {account?.lastXrayId ? t('shell.openApp') : t('shell.mapOwn')}
              </Link>
            </>
          ) : (
            <span className={st.pending} aria-hidden="true" />
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * A standalone page's header (/cup): the logo, which goes to the landing, and on the right «Log in» or the
 * account menu, so the jury can sign in. No site tabs: on a page of its own they read as fake navigation.
 */
function MinimalHeader({ surface }: { surface: 'paper' | 'field' }) {
  const { t } = useT();
  const account = useAccount();
  return (
    <header className={st.header} data-surface={surface} data-account={account ? '' : undefined}>
      <div className={st.inner}>
        <div className={st.left}>
          <Link href="/" className={st.brand} aria-label={t('shell.homeGuest')}>
            <KeystoneMark size={32} tone={surface === 'field' ? 'violet' : 'paper'} />
            <span className={st.wordmark}>Irreplaceable</span>
          </Link>
          {account?.demo ? <DemoMark /> : null}
        </div>
        <div className={st.right}>
          {account?.email ? (
            <HeaderAccount snapshot={account} surface={surface} parts={{ streak: false }} />
          ) : account !== undefined ? (
            <LoginButton surface={surface} />
          ) : (
            <span className={st.pending} aria-hidden="true" />
          )}
        </div>
      </div>
    </header>
  );
}
