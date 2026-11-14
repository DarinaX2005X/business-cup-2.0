import { CalendarCheck, ChartLine, House, MessagesSquare, Store, Waypoints, type LucideIcon } from 'lucide-react';

/**
 * Sections of the app shell. MAIN turns a section on by setting `enabled: true`; the shell also checks on
 * the server that the section's page file exists (src/components/shell/routes.ts), so a section whose
 * screen is still being built stays hidden until it lands. The header, the phone tab bar and the More
 * sheet all read this list in NAV_ORDER, so nothing else changes.
 */

/** Order of the sections in the header: Home, Today, My week, Progress, Coach, Shop. */
export const NAV_ORDER = ['home', 'today', 'week', 'progress', 'coach', 'shop'] as const;
/** The phone tab bar: these four (when available) and More. */
export const TAB_BAR = ['home', 'today', 'week', 'coach'] as const;

export interface NavContext {
  /** The visitor's latest week map, if any. */
  lastXrayId: string | null;
}

export interface NavSection {
  id: 'week' | 'today' | 'progress' | 'shop' | 'home' | 'coach';
  /** Key in the `shell` dictionary. */
  labelKey: string;
  icon: LucideIcon;
  enabled: boolean;
  /** The section's page file under src/app/(app)/, checked on the server before the section is shown. */
  page?: string;
  href: (ctx: NavContext) => string;
  /** Whether the current path belongs to this section. */
  match: (pathname: string) => boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    labelKey: 'shell.nav.home',
    icon: House,
    enabled: true,
    page: 'home/page.tsx',
    href: () => '/home',
    match: (p) => p === '/home' || p.startsWith('/home/'),
  },
  {
    id: 'week',
    labelKey: 'shell.nav.week',
    icon: Waypoints,
    enabled: true,
    page: 'x/[id]/page.tsx',
    href: ({ lastXrayId }) => (lastXrayId ? `/x/${lastXrayId}` : '/start'),
    match: (p) => p.startsWith('/x/'),
  },
  {
    id: 'today',
    labelKey: 'shell.nav.today',
    icon: CalendarCheck,
    enabled: true,
    page: 'today/page.tsx',
    href: () => '/today',
    match: (p) => p.startsWith('/today'),
  },
  {
    id: 'progress',
    labelKey: 'shell.nav.progress',
    icon: ChartLine,
    enabled: true,
    page: 'progress/page.tsx',
    href: () => '/progress',
    match: (p) => p.startsWith('/progress'),
  },
  {
    id: 'coach',
    labelKey: 'shell.nav.coach',
    icon: MessagesSquare,
    enabled: true,
    page: 'coach/page.tsx',
    href: () => '/coach',
    match: (p) => p.startsWith('/coach'),
  },
  {
    id: 'shop',
    labelKey: 'shell.nav.shop',
    icon: Store,
    enabled: true,
    page: 'shop/page.tsx',
    href: () => '/shop',
    match: (p) => p.startsWith('/shop'),
  },
];

export const enabledSections = () => NAV_SECTIONS.filter((s) => s.enabled);

export type SectionId = NavSection['id'];

/** Sections in header order, limited to the ids the server found available. */
export function orderedSections(available: readonly string[]): NavSection[] {
  const on = new Set(available);
  return NAV_ORDER.map((id) => NAV_SECTIONS.find((s) => s.id === id)).filter((s): s is NavSection => !!s && s.enabled && on.has(s.id));
}
