import type { Metadata } from 'next';
import { LeaderboardScreen } from '@/components/leaderboard/LeaderboardScreen';
import { getRequestT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestT();
  return { title: `${t('leaderboard.meta.title')} · Irreplaceable`, robots: { index: false, follow: false } };
}

/** The weekly leaderboard by XP: real profiles only, loaded on the client from /api/leaderboard. */
export default function LeaderboardPage() {
  return <LeaderboardScreen />;
}
