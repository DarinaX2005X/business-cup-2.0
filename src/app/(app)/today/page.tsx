import type { Metadata } from 'next';
import { Suspense } from 'react';
import { todayFixtures } from '@/components/today/__fixtures__/today';
import { LoadingView } from '@/components/today/Hub';
import { TodayScreen } from '@/components/today/TodayScreen';
import { getRequestLocale, getT } from '@/i18n/server';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('today.meta.title'), robots: { index: false, follow: false } };
}

/**
 * Today: the daily rep. Everything here belongs to the visitor's profile, so the screen loads on the
 * client from /api/reps/today. In development `?fixture=<name>` shows one of the stored screen states
 * (src/components/today/__fixtures__); production ignores it.
 */
export default async function TodayPage({ searchParams }: Props) {
  const sp = await searchParams;
  const name = typeof sp.fixture === 'string' ? sp.fixture : null;
  const fixture = process.env.NODE_ENV !== 'production' && name ? todayFixtures[name] : undefined;
  return (
    <Suspense fallback={<LoadingView />}>
      <TodayScreen key={name ?? 'live'} fixture={fixture} />
    </Suspense>
  );
}
