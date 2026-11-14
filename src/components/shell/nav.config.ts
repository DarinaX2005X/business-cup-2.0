import { CalendarCheck, ChartLine, Store, Waypoints, type LucideIcon } from 'lucide-react';

/**
 * Sections of the app shell. MAIN turns a section on by setting `enabled: true` once its screen exists;
 * the header and the bottom bar on narrow screens both read this list, so nothing else changes.
 */

export interface NavContext {
  /** The visitor's latest week map, if any. */
  lastXrayId: string | null;
}

export interface NavSection {
  id: 'week' | 'today' | 'progress' | 'shop';
  /** Key in the `shell` dictionary. */
  labelKey: string;
  icon: LucideIcon;
  enabled: boolean;
  href: (ctx: NavContext) => string;
  /** Whether the current path belongs to this section. */
  match: (pathname: string) => boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'week',
    labelKey: 'shell.nav.week',
    icon: Waypoints,
    enabled: true,
    href: ({ lastXrayId }) => (lastXrayId ? `/x/${lastXrayId}` : '/start'),
    match: (p) => p.startsWith('/x/'),
  },
  {
    id: 'today',
    labelKey: 'shell.nav.today',
    icon: CalendarCheck,
    enabled: false,
    href: () => '/today',
    match: (p) => p.startsWith('/today'),
  },
  {
    id: 'progress',
    labelKey: 'shell.nav.progress',
    icon: ChartLine,
    enabled: false,
    href: () => '/progress',
    match: (p) => p.startsWith('/progress'),
  },
  {
    id: 'shop',
    labelKey: 'shell.nav.shop',
    icon: Store,
    enabled: false,
    href: () => '/shop',
    match: (p) => p.startsWith('/shop'),
  },
];

export const enabledSections = () => NAV_SECTIONS.filter((s) => s.enabled);
