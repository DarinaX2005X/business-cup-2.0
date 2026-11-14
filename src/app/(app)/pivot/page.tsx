import type { Metadata } from 'next';
import { PivotScreen } from '@/components/pivot/PivotScreen';
import { getRequestLocale, getT } from '@/i18n/server';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { ownedMap, pivotView } from './data';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('pivot.meta.title'), robots: { index: false, follow: false } };
}

/**
 * Where the person can go next (05.2.1): neighbouring jobs of their latest week map, rendered on the server
 * from the profile cookie. Free sees the first neighbour and a locked panel for the rest.
 */
export default async function PivotPage({ searchParams }: Props) {
  const [sp, locale, profile] = await Promise.all([searchParams, getRequestLocale(), getProfileFromCookies()]);
  // Development only: see the Free view while DEV_FORCE_PRO is on.
  const forceFree = process.env.NODE_ENV !== 'production' && sp.plan === 'free';
  const owned = await ownedMap(profile, { forceFree });
  const view = owned ? await pivotView(owned, locale) : null;
  return <PivotScreen view={view} />;
}
