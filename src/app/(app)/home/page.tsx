import type { Metadata } from 'next';
import { HomeScreen } from '@/components/home/HomeScreen';
import { getRequestT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return { title: `${t('home.meta.title')} · Irreplaceable`, robots: { index: false, follow: false } };
}

/**
 * Home: the start page once a profile exists. Everything on it belongs to the visitor, so the screen
 * loads on the client (today's rep, the plan summary); the shell's server snapshot gives the greeting,
 * the job and the streak on the first paint.
 */
export default function HomePage() {
  return <HomeScreen />;
}
