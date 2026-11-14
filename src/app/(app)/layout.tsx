import type { ReactNode } from 'react';
import { snapshotOf } from '@/components/shell/account';
import { AppShell, type ShellInitial } from '@/components/shell/AppShell';
import { availablePages, availableSections } from '@/components/shell/routes';
import { getProfileFromCookies } from '@/server/profile/ssr';

/**
 * Every in-app page lives in one shell with the same header: the logo (to Home), Home, Today, My week,
 * Progress, Coach and Shop, and on the right points, streak, level and the account menu. The server
 * reads the profile cookie so the first paint already shows the visitor's account, and checks which
 * sections have a page, so a section still being built never shows a dead link.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getProfileFromCookies();
  const initial: ShellInitial = {
    account: profile ? snapshotOf(profile) : null,
    sections: availableSections(),
    pages: availablePages(),
  };
  return <AppShell initial={initial}>{children}</AppShell>;
}
