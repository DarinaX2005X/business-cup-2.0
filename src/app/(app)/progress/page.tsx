import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlanProgress } from '@/components/plan/PlanProgress';
import { ProgressScreen } from '@/components/progress/ProgressScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('progress.meta.title'), robots: { index: false, follow: false } };
}

/**
 * Progress: score line, practice calendar and level, proof log, Review kit. Everything belongs to the
 * visitor's profile, so the screen loads on the client from /api/progress and /api/points.
 * The 90-day plan's progress sits beside the Review kit through `planSlot`.
 */
export default function ProgressPage() {
  return (
    <Suspense>
      <ProgressScreen planSlot={<PlanProgress />} />
    </Suspense>
  );
}
