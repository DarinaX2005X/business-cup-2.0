import type { Metadata } from 'next';
import { SuccessScreen } from '@/components/pricing/SuccessScreen';
import { getRequestLocale, getT } from '@/i18n/server';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(await getRequestLocale());
  return { title: t('pricing.success.meta'), robots: { index: false, follow: false } };
}

/** Return from Stripe Checkout: `?session_id={CHECKOUT_SESSION_ID}` is confirmed on the client. */
export default async function ProSuccessPage({ searchParams }: Props) {
  const sp = await searchParams;
  const sessionId = typeof sp.session_id === 'string' && sp.session_id ? sp.session_id : null;
  return <SuccessScreen key={sessionId ?? 'none'} sessionId={sessionId} />;
}
