import type { Metadata } from 'next';
import { CupPage } from '@/components/cup/CupPage';
import type { ProfilePlan } from '@/components/cup/plan';
import { getRequestT } from '@/i18n/server';
import { getProfileFromCookies } from '@/server/profile/ssr';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return {
    title: t('cup.meta.title'),
    description: t('cup.meta.description'),
    alternates: { canonical: '/cup' },
    openGraph: { title: t('cup.meta.title'), description: t('cup.meta.description'), url: '/cup', type: 'website', siteName: 'Irreplaceable' },
  };
}

/**
 * Business Cup 2.0: Pro for 30 days without payment (04.1.4). The server reads the profile cookie so a
 * visitor who already has Pro sees that state in the first paint instead of the offer.
 */
export default async function CupRoute() {
  const profile = await getProfileFromCookies();
  return <CupPage initialPlan={(profile?.plan as ProfilePlan | undefined) ?? null} hasMap={!!profile?.lastXrayId} />;
}
