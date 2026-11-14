import type { Metadata } from 'next';
import { ProfileScreen } from '@/components/profile/ProfileScreen';
import { getRequestLocale, getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('profile.meta.title'), robots: { index: false, follow: false } };
}

/** Settings, the restore link, the subscription and deleting everything. Loads on the client from the profile. */
export default function ProfilePage() {
  return <ProfileScreen />;
}
