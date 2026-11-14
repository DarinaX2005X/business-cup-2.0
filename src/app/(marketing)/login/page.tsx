import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthPage } from '@/components/auth/AuthPage';
import { getRequestT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return { title: `${t('auth.meta.login')} · Irreplaceable`, robots: { index: false, follow: false } };
}

export default function Page() {
  return (
    <Suspense>
      <AuthPage mode="login" />
    </Suspense>
  );
}
