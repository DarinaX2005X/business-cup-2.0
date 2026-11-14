import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { scoreCardMetadata } from '@/app/api/og/meta';
import { PublicProof } from '@/components/progress/PublicProof';
import { siteUrl } from '@/components/public/data';
import { getT } from '@/i18n/messages';
import { readPublicPortfolio } from '@/server/progress';

type Props = { params: Promise<{ slug: string }> };

// The page reads the profile behind the slug on every request: a rep made private or a deleted profile disappears at once.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = getT('en');
  const data = await readPublicPortfolio(slug, 'en').catch(() => null);
  if (!data) return { title: t('progress.public.notFoundTitle'), robots: { index: false, follow: false } };
  const title = t('progress.meta.publicTitle', { job: data.occupationTitle });
  const description = t('progress.meta.publicDescription');
  return {
    metadataBase: siteUrl(),
    title,
    description,
    robots: { index: false, follow: true },
    // the share card of the latest week map (05.2.2), so LinkedIn shows the person's week
    ...(data.card ? scoreCardMetadata(data.card, { title, description }) : {}),
  };
}

/** A person's public proof page: verified reps they chose to show, without any personal data. */
export default async function PublicProofPage({ params }: Props) {
  const { slug } = await params;
  const data = await readPublicPortfolio(slug, 'en');
  if (!data) notFound();
  return <PublicProof data={data} t={getT('en')} />;
}
