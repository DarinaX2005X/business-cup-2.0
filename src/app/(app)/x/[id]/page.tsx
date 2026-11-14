import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { XrayScreen } from '@/components/xray/XrayScreen';
import type { ClientBundle } from '@/components/xray/types';
import { getRequestLocale, getT } from '@/i18n/server';
import { isPro } from '@/server/profile';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { getLocalTitles, getRelated, loadBundle } from '@/server/xray/data';
import { readXray, viewXray } from '@/server/xray/records';
import { getTaskTexts } from '@/server/xray/tips';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = getT(await getRequestLocale());
  const x = await readXray(id).catch(() => null);
  return {
    title: x ? t('xray.meta.title', { jobTitle: x.jobTitle }) : t('xray.notFound.title'),
    robots: { index: false, follow: false },
  };
}

/**
 * Week map: rendered on the server from the profile cookie (owner sees their pay and practice; anyone
 * else gets the shared view without personal data), then recomputed live on the client while editing.
 */
export default async function XrayPage({ params, searchParams }: Props) {
  const [{ id }, sp, locale, viewer] = await Promise.all([params, searchParams, getRequestLocale(), getProfileFromCookies()]);
  const view = await viewXray(id, viewer);
  if (!view) notFound();
  const bundle = await loadBundle(view.xray.occupationCode);
  if (!bundle) notFound();

  let pro = view.isOwner && viewer ? isPro(viewer) : false;
  // Development only: see the Free view while DEV_FORCE_PRO is on.
  if (process.env.NODE_ENV !== 'production' && sp.plan === 'free') pro = false;

  const [texts, localTitles] = await Promise.all([getTaskTexts(bundle.code, locale), getLocalTitles(locale).catch(() => null)]);

  // Locked blocks never reach the client: Free gets the first neighbour and the count only.
  const client: ClientBundle = {
    code: bundle.code,
    slug: bundle.slug,
    title: bundle.title,
    description: bundle.description,
    wage: bundle.wage,
    tasks: bundle.tasks,
    typicalHumanShare: bundle.typicalHumanShare,
    dataVersion: bundle.dataVersion,
    related: pro ? await getRelated(bundle.code) : bundle.related.slice(0, 1),
    relatedCount: bundle.relatedCount ?? bundle.related.length,
  };

  const focus = typeof sp.focus === 'string' ? sp.focus : null;

  return (
    <XrayScreen
      key={view.xray.id}
      xray={view.xray}
      isOwner={view.isOwner}
      isPro={pro}
      trialAvailable={!viewer || viewer.trial.status !== 'used'}
      bundle={client}
      texts={texts?.tasks ?? {}}
      textsReady={texts?.ready ?? false}
      textsLocale={locale}
      occupationTitle={localTitles?.get(bundle.code) ?? bundle.title}
      initialFocus={focus}
      initialTab={typeof sp.tab === 'string' ? sp.tab : null}
    />
  );
}
