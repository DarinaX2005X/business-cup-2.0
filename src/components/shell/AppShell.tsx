'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { KeystoneMark } from '@/components/kit/Mark';
import { Sheet } from '@/components/kit/Overlay';
import { StreakWeek } from '@/components/kit/Points';
import btn from '@/components/kit/controls.module.css';
import { REWARDS } from '@/domain/points';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { ACCOUNT_LINKS, streakWeekOf, type AccountSnapshot } from './account';
import { AuthButtons, DemoMark, HeaderAccount, LoginButton, useAccount } from './HeaderAccount';
import { orderedSections, TAB_BAR, type NavSection } from './nav.config';
import { AccountList, HelpDialog, LevelStone } from './ShellMenus';
import st from './shell.module.css';

/** What the server already knows, so the first paint of the header is right. */
export interface ShellInitial {
  /** The visitor's account from the profile cookie, or null for a visitor without a profile. */
  account: AccountSnapshot | null;
  /** Nav sections that are on and whose page exists (src/components/shell/routes.ts). */
  sections: string[];
  /** Other pages that exist (leaderboard, profile, playbook, second-look, pivot). */
  pages: string[];
}

const ShellRoutes = createContext<ShellInitial>({ account: null, sections: [], pages: [] });

/** Which sections and pages exist and the server's account snapshot, for screens inside the shell (Home). */
export const useShellRoutes = () => useContext(ShellRoutes);

export function AppShell({ initial, children }: { initial: ShellInitial; children: ReactNode }) {
  const { t } = useT();
  const pathname = usePathname() ?? '';
  const { status, profile, balance } = useProfile();
  const account = useAccount(initial.account);
  const hasProfile = !!account;
  const sections = hasProfile ? orderedSections(initial.sections) : [];
  const lastXrayId = account?.lastXrayId ?? null;
  const [more, setMore] = useState(false);
  const [help, setHelp] = useState(false);
  const closeMore = useCallback(() => setMore(false), []);

  // A reward the person can already redeem and has not seen the shop yet: an apricot dot on Shop.
  const rewardReady =
    status === 'ready' &&
    !!profile &&
    !profile.hintsSeen.includes('shop_opened') &&
    REWARDS.some((r) => r.cost !== null && r.kind !== 'coming_soon' && r.cost <= balance);
  const dot = (id: string) =>
    id === 'shop' && rewardReady ? (
      <>
        <span className={st.dot} aria-hidden="true" />
        <span className="sr-only">{t('shell.nav.shopReady')}</span>
      </>
    ) : null;

  const tabs = TAB_BAR.map((id) => sections.find((s) => s.id === id)).filter((s): s is NavSection => !!s);
  const rest = sections.filter((s) => !tabs.includes(s));
  const moreActive = rest.some((s) => s.match(pathname)) || pathname.startsWith(ACCOUNT_LINKS.leaderboard);
  const moreWeek = account ? streakWeekOf(account.streakDays, account.createdAt) : null;

  const link = (s: NavSection, cls: string, size: number, onClick?: () => void) => {
    const Icon = s.icon;
    return (
      <Link href={s.href({ lastXrayId })} className={cls} aria-current={s.match(pathname) ? 'page' : undefined} onClick={onClick}>
        <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
        <span>{t(s.labelKey)}</span>
        {dot(s.id)}
      </Link>
    );
  };

  return (
    <ShellRoutes.Provider value={initial}>
      <div className={st.shell} data-tabbar={hasProfile || undefined}>
        <a href="#main" className={st.skip}>
          {t('shell.skip')}
        </a>
        <header className={st.header}>
          <div className={st.bar}>
            <div className={st.left}>
              <Link href={hasProfile ? ACCOUNT_LINKS.home : '/'} className={st.brand} aria-label={hasProfile ? t('shell.home') : t('shell.homeGuest')}>
                <KeystoneMark size={32} />
                <span className={st.wordmark}>Irreplaceable</span>
              </Link>
              {account?.demo ? <DemoMark /> : null}
            </div>
            {sections.length ? (
              <nav className={st.nav} aria-label={t('shell.nav.label')}>
                <ul>
                  {sections.map((s) => (
                    <li key={s.id}>{link(s, st.navLink, 18)}</li>
                  ))}
                </ul>
              </nav>
            ) : null}
            <div className={st.right}>
              {account ? (
                <HeaderAccount snapshot={account} />
              ) : account === null ? (
                <>
                  <LoginButton />
                  <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>
                    {t('shell.mapOwn')}
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main id="main" className={st.main}>
          {children}
        </main>

        {hasProfile && sections.length ? (
          <nav className={st.tabbar} aria-label={t('shell.nav.label')}>
            <ul>
              {tabs.map((s) => (
                <li key={s.id}>{link(s, st.tab, 22)}</li>
              ))}
              <li>
                <button type="button" className={st.tab} aria-haspopup="dialog" aria-expanded={more} data-active={moreActive || undefined} onClick={() => setMore(true)}>
                  <Ellipsis size={22} strokeWidth={1.75} aria-hidden="true" />
                  <span>{t('shell.nav.more')}</span>
                  {rest.some((s) => s.id === 'shop') ? dot('shop') : null}
                </button>
              </li>
            </ul>
          </nav>
        ) : null}

        {account ? (
          <Sheet open={more} onClose={closeMore} title={t('shell.more.title')}>
            <div className={st.moreBody}>
              {account.email ? (
              <div className={st.moreStats}>
                <Link href={ACCOUNT_LINKS.progress} className={st.moreStat} onClick={closeMore}>
                  <StreakWeek done={moreWeek!.done} today={moreWeek!.today} count={moreWeek!.count} />
                </Link>
                <Link href={ACCOUNT_LINKS.leaderboard} className={st.moreStat} onClick={closeMore}>
                  <LevelStone level={account.level.level} size={32} />
                  <span>
                    <b>{t('shell.level.short', { level: account.level.level })}</b>
                    <small>{account.level.levelName}</small>
                  </span>
                </Link>
              </div>
              ) : null}
              {rest.length ? (
                <ul className={st.moreSections} aria-label={t('shell.more.sections')}>
                  {rest.map((s) => (
                    <li key={s.id}>{link(s, st.moreLink, 20, closeMore)}</li>
                  ))}
                </ul>
              ) : null}
              <div className={st.moreAccount} aria-label={t('shell.more.account')} role="group">
                {account.email ? <AccountList snapshot={account} onDone={closeMore} onHelp={() => setHelp(true)} /> : <AuthButtons />}
              </div>
            </div>
          </Sheet>
        ) : null}
        <HelpDialog open={help} onClose={() => setHelp(false)} />
      </div>
    </ShellRoutes.Provider>
  );
}
