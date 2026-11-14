import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReviewKitScreen } from '@/components/progress/ReviewKitScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('progress.meta.kitTitle'), robots: { index: false, follow: false } };
}

/** The Review kit brief (Pro): written on open from the visitor's reps, printable on one A4 page. */
export default function ReviewKitPage() {
  return (
    <Suspense>
      <ReviewKitScreen />
    </Suspense>
  );
}
