import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SecondLookScreen } from '@/components/second-look/SecondLookScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('playbook.secondLook.meta.title'), robots: { index: false, follow: false } };
}

/**
 * Second look: paste a real AI draft from work, get the places a careful specialist would check.
 * The text stays in this page; the server reads it once and keeps only a counter.
 */
export default function SecondLookPage() {
  return (
    <Suspense fallback={null}>
      <SecondLookScreen />
    </Suspense>
  );
}
