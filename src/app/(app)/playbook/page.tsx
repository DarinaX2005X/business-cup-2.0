import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlaybookScreen } from '@/components/playbook/PlaybookScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('playbook.meta.title'), robots: { index: false, follow: false } };
}

/**
 * Playbook: the person's instructions for AI, one per task of their week. Everything belongs to the
 * visitor's profile, so the screen loads on the client from /api/playbook. `?task=<id>` opens a card.
 */
export default function PlaybookPage() {
  return (
    <Suspense fallback={null}>
      <PlaybookScreen />
    </Suspense>
  );
}
