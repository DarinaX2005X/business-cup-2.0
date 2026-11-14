'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { KeystoneMark } from '@/components/kit/Mark';
import { PointsCounter, StreakWeek } from '@/components/kit/Points';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { enabledSections } from './nav.config';
import { AccountSheetButton, LocaleMenu, ProfileMenu } from './ShellMenus';
import st from './shell.module.css';

/** What the server already knows about the visitor, so the first paint of the header is right. */
export interface ShellInitial {
  hasProfile: boolean;
  balance: number;
  streakDays: string[];
  lastXrayId: string | null;
}

/** Monday-first week of the visitor's local calendar: which days have practice, and today's index. */
function weekOf(days: string[]): { done: boolean[]; today: number } {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const set = new Set(days);
  const done = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - today + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return set.has(key);
  });
  return { done, today };
}

export function AppShell({ initial, children }: { initial: ShellInitial; children: ReactNode }) {
  const { t } = useT();
  const pathname = usePathname() ?? '';
  const { status, profile, balance } = useProfile();
  const live = status === 'ready' || status === 'anonymous';
  const hasProfile = live ? status === 'ready' : initial.hasProfile;
  const points = status === 'ready' ? balance : initial.balance;
  const streakDays = status === 'ready' ? (profile?.streak.days ?? []) : initial.streakDays;
  const lastXrayId = (status === 'ready' ? profile?.lastXrayId : initial.lastXrayId) ?? null;
  const sections = enabledSections();
  const week = weekOf(streakDays);
  const streakCount = week.done.filter(Boolean).length;

  const mapOwn = (
    <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>
      {t('shell.mapOwn')}
    </Link>
  );

  return (
    <div className={st.shell}>
      <a href="#main" className={st.skip}>
        {t('shell.skip')}
      </a>
      <header className={st.header}>
        <div className={st.bar}>
          <Link href={lastXrayId ? `/x/${lastXrayId}` : '/'} className={st.brand} aria-label={t('shell.home')}>
            <KeystoneMark size={32} />
            <span className={st.wordmark}>Irreplaceable</span>
          </Link>
          <nav className={st.nav} aria-label={t('shell.nav.label')}>
            <ul>
              {sections.map((s) => {
                const active = s.match(pathname);
                const Icon = s.icon;
                return (
                  <li key={s.id}>
                    <Link href={s.href({ lastXrayId })} className={st.navLink} aria-current={active ? 'page' : undefined}>
                      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                      {t(s.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={st.right}>
            {hasProfile ? (
              <>
                <PointsCounter value={points} label={t('shell.pointsLabel')} />
                <div className={st.streakSlot} title={t('shell.streak', { count: streakCount })}>
                  <StreakWeek done={week.done} today={week.today} count={streakCount} />
                </div>
              </>
            ) : (
              <span className={st.wideOnly}>{mapOwn}</span>
            )}
            <span className={st.wideOnly}>
              <LocaleMenu />
            </span>
            {hasProfile ? (
              <span className={st.wideOnly}>
                <ProfileMenu />
              </span>
            ) : null}
            <span className={st.narrowOnly}>
              <AccountSheetButton
                hasProfile={hasProfile}
                extra={
                  hasProfile ? (
                    <div className={st.sheetStreak}>
                      <StreakWeek done={week.done} today={week.today} count={streakCount} />
                    </div>
                  ) : (
                    mapOwn
                  )
                }
              />
            </span>
          </div>
        </div>
      </header>
      <main id="main" className={st.main}>
        {children}
      </main>
      <nav className={st.tabbar} aria-label={t('shell.nav.label')}>
        <ul>
          {sections.map((s) => {
            const active = s.match(pathname);
            const Icon = s.icon;
            return (
              <li key={s.id}>
                <Link href={s.href({ lastXrayId })} className={st.tab} aria-current={active ? 'page' : undefined}>
                  <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
                  <span>{t(s.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
