import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { siteUrl } from '@/components/public/data';
import { getRequestT } from '@/i18n/server';

/** Metadata of the marketing section. The share image is src/app/opengraph-image.tsx. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  const title = t('landing.meta.title');
  const description = t('landing.meta.description');
  return {
    metadataBase: siteUrl(),
    title,
    description,
    applicationName: 'Irreplaceable',
    alternates: { canonical: '/' },
    openGraph: { title, description, url: '/', type: 'website', siteName: 'Irreplaceable', locale: t.locale },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/** The violet field of the first screen. */
export const viewport: Viewport = { themeColor: '#5030BA' };

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
