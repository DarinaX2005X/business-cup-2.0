import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gallery, type GalleryWidth } from './Gallery';

export const metadata: Metadata = {
  title: 'Craft kit gallery',
  robots: { index: false, follow: false },
};

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function GalleryPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  if (process.env.NODE_ENV === 'production' && sp.gallery !== '1') notFound();
  const lang = sp.lang === 'ru' || sp.lang === 'kk' ? sp.lang : 'en';
  const w: GalleryWidth = sp.w === '768' || sp.w === '390' ? sp.w : '1440';
  return <Gallery initialLang={lang} initialWidth={w} />;
}
