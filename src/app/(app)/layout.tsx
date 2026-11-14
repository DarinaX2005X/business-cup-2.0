import type { ReactNode } from 'react';
import { AppShell, type ShellInitial } from '@/components/shell/AppShell';
import { getProfileFromCookies } from '@/server/profile/ssr';

/**
 * Product screens: the app shell around every page of the group. The profile provider lives in the
 * root layout (AppProviders); here the server only reads the profile cookie so the header's first
 * paint already shows the visitor's points and streak, or the guest's «Map your own week».
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getProfileFromCookies();
  const initial: ShellInitial = {
    hasProfile: !!profile,
    balance: profile?.points.balance ?? 0,
    streakDays: profile?.streak.days ?? [],
    lastXrayId: profile?.lastXrayId ?? null,
  };
  return <AppShell initial={initial}>{children}</AppShell>;
}
