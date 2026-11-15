'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PointsCounter, StreakWeek } from '@/components/kit/Points';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useOptionalProfile } from '@/lib/client/profile';
import { ACCOUNT_LINKS, snapshotOf, streakWeekOf, type AccountSnapshot } from './account';
import { AccountMenu, LevelStone } from './ShellMenus';
import st from './shell.module.css';

/**
 * The visitor's account as the header shows it: the live profile once it has loaded, else the snapshot
 * the server read from the profile cookie (first paint). `null` for a visitor without a profile;
 * `undefined` while a page without a server snapshot is still loading the profile.
 */
export function useAccount(initial?: AccountSnapshot | null): AccountSnapshot | null | undefined {
  const ctx = useOptionalProfile();
  const status = ctx?.status ?? 'anonymous';
  const profile = ctx?.profile ?? null;
  const balance = ctx?.balance;
  return useMemo(() => {
    if (status === 'ready' && profile) return { ...snapshotOf(profile), balance: balance ?? profile.points.balance };
    if (status === 'anonymous' || status === 'orphaned') return null;
    return initial === undefined ? undefined : initial;
  }, [status, profile, balance, initial]);
}

/** The demo mark beside the logo: Business Cup jury accounts built from a sample resume. */
export function DemoMark() {
  const { t } = useT();
  return (
    <span className={st.demoMark} title={t('shell.demoHint')}>
      {t('shell.demo')}
    </span>
  );
}

export interface HeaderParts {
  points?: boolean;
  streak?: boolean;
  level?: boolean;
}

/**
 * The right side of every header: points (open the shop), the week's streak (opens progress), the level
 * (opens the leaderboard) and the avatar with the account menu. The same on the app shell, the /start
 * flow and the marketing pages. A guest gets Log in and Sign up instead.
 */
export function HeaderAccount({ snapshot, parts = {}, surface = 'paper' }: { snapshot: AccountSnapshot; parts?: HeaderParts; surface?: 'paper' | 'field' }) {
  const { t } = useT();
  // A guest (a profile without an account) sees only Log in and Sign up: points, streak, level and the
  // avatar belong to an account, and next to «Log in» they read as someone else's.
  if (!snapshot.email) return <AuthButtons surface={surface} />;
  const { points = true, level = true, streak = true } = parts;
  const week = streakWeekOf(snapshot.streakDays, snapshot.createdAt);
  const lv = snapshot.level;
  return (
    <div className={st.account} data-surface={surface}>
      {points ? (
        <Link href={ACCOUNT_LINKS.shop} className={st.pill} aria-label={t('shell.pointsLink', { count: snapshot.balance })}>
          <PointsCounter value={snapshot.balance} label={t('shell.pointsLabel')} surface={surface === 'field' ? 'violet' : 'paper'} />
        </Link>
      ) : null}
      {streak ? (
        <Link
          href={ACCOUNT_LINKS.progress}
          className={`${st.pill} ${st.streakSlot}`}
          data-since={week.since || undefined}
          aria-label={t('shell.streakLink', { count: week.count })}
          title={t('shell.streak', { count: week.count })}
        >
          <StreakWeek done={week.done} today={week.today} count={week.count} />
        </Link>
      ) : null}
      {level ? (
        <Link
          href={ACCOUNT_LINKS.leaderboard}
          className={`${st.pill} ${st.level}`}
          aria-label={t('shell.level.link', { level: lv.level, name: lv.levelName })}
          title={lv.nextAt !== null ? t('shell.level.next', { count: lv.nextAt - lv.xp, level: lv.level + 1 }) : t('shell.level.top')}
        >
          <LevelStone level={lv.level} />
          <span className={st.levelText}>{t('shell.level.short', { level: lv.level })}</span>
        </Link>
      ) : null}
      <AccountMenu snapshot={snapshot} />
    </div>
  );
}

/** «Log in» on its own, for headers whose main button is «Map my week». */
export function LoginButton({ surface = 'paper' }: { surface?: 'paper' | 'field' }) {
  const { t } = useT();
  const { openAuth } = useAuth();
  return (
    <span className={st.authButtons} data-surface={surface}>
      <button type="button" className={st.loginBtn} onClick={() => openAuth('login')}>
        {t('auth.header.login')}
      </button>
    </span>
  );
}

/**
 * Log in and Sign up (or «Save my progress» for a guest who already has progress). Both open the account
 * dialog in place; the form keeps the guest's map and progress when it creates the account.
 */
export function AuthButtons({ surface = 'paper', save = false }: { surface?: 'paper' | 'field'; save?: boolean }) {
  const { t } = useT();
  const { openAuth } = useAuth();
  return (
    <div className={st.authButtons} data-surface={surface}>
      <button type="button" className={st.loginBtn} onClick={() => openAuth('login')}>
        {t('auth.header.login')}
      </button>
      <button type="button" className={`${btn.btn} ${surface === 'field' ? btn.b_lavender : btn.b_primary} ${btn.s_sm}`} onClick={() => openAuth('signup')}>
        {save ? t('auth.header.save') : t('auth.header.signup')}
      </button>
    </div>
  );
}
