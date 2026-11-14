import type { Metadata } from 'next';
import { shopFixtures } from '@/components/shop/__fixtures__/shop';
import { ShopScreen } from '@/components/shop/ShopScreen';
import { getRequestLocale, getT } from '@/i18n/server';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('shop.meta.title'), robots: { index: false, follow: false } };
}

/**
 * The points shop. Balance, rewards and history belong to the visitor's profile, so the screen loads on
 * the client from /api/shop and /api/points. In development `?fixture=<name>` shows a stored state
 * (src/components/shop/__fixtures__); production ignores it.
 */
export default async function ShopPage({ searchParams }: Props) {
  const sp = await searchParams;
  const name = typeof sp.fixture === 'string' ? sp.fixture : null;
  const fixture = process.env.NODE_ENV !== 'production' && name ? shopFixtures[name] : undefined;
  return <ShopScreen key={name ?? 'live'} fixture={fixture} />;
}
