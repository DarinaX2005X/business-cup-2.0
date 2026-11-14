import type { Metadata } from 'next';
import { CoachScreen } from '@/components/coach/CoachScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('coach.meta.title'), robots: { index: false, follow: false } };
}

/**
 * The personal career coach (Coach plan). Everything on it belongs to the visitor's profile, so the screen
 * loads on the client from /api/coach.
 */
export default function CoachPage() {
  return <CoachScreen />;
}
