import type { Metadata } from 'next';
import { SiteFooter } from '@/components/landing/Footer';
import { PricingPage } from '@/components/pricing/PricingPage';
import type { ProfilePlan } from '@/components/cup/plan';
import { getRequestLocale, getT } from '@/i18n/server';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { firstWeekFor } from './week';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [t, sp] = [getT(await getRequestLocale()), await searchParams];
  const personal = typeof sp.from === 'string';
  return {
    title: personal ? t('pricing.meta.weekTitle') : t('pricing.meta.title'),
    description: t('pricing.meta.description'),
    alternates: { canonical: '/pricing' },
    ...(personal ? { robots: { index: false, follow: false } } : {}),
  };
}

/**
 * Pricing. The profile cookie gives the first paint its plan, issued shop code and map link; with
 * `?from=<xrayId>` the owner of that map also gets their first week of reps, computed on the server.
 */
export default async function PricingRoute({ searchParams }: Props) {
  const [sp, locale, profile] = await Promise.all([searchParams, getRequestLocale(), getProfileFromCookies()]);
  const from = typeof sp.from === 'string' ? sp.from : null;
  const week = profile && from ? await firstWeekFor(profile, from, locale).catch(() => null) : null;
  return (
    <>
    <PricingPage
      canceled={sp.canceled === '1'}
      portal={sp.portal === '1'}
      week={week}
      initial={{
        plan: (profile?.plan as ProfilePlan | undefined) ?? null,
        redemptions: profile?.redemptions ?? [],
        lastXrayId: profile?.lastXrayId ?? null,
      }}
    />
    <SiteFooter t={getT(locale)} />
    </>
  );
}
