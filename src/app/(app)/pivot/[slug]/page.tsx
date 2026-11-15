import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AsJobScreen } from '@/components/pivot/AsJobScreen';
import { carryWeek } from '@/components/pivot/carry';
import type { AsJobView } from '@/components/pivot/types';
import { taskLabel } from '@/components/xray/lib';
import { computeXray } from '@/domain/xray';
import { getRequestLocale, getT } from '@/i18n/server';
import { getProfileFromCookies } from '@/server/profile/ssr';
import { getLocalTitles, getOccupationIndex, getRelated, loadBundle } from '@/server/xray/data';
import { getTaskTexts } from '@/server/xray/tips';
import { moveViews, ownedMap, visibleRelated } from '../data';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const SLUG_RE = /^[a-z0-9-]{1,120}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getRequestLocale()]);
  const t = getT(locale);
  const entry = SLUG_RE.test(slug) ? [...(await getOccupationIndex()).values()].find((e) => e.slug === slug) : undefined;
  const title = entry ? ((await getLocalTitles(locale).catch(() => null))?.get(entry.code) ?? entry.title) : t('pivot.meta.title');
  return { title: entry ? t('pivot.meta.asTitle', { title }) : title, robots: { index: false, follow: false } };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * «Map my week as this job» (05.2.1): the person's latest week moved into one neighbouring job by shared
 * work activities (`carryWeek`), computed on each visit and never saved, so the real map stays as it is.
 */
export default async function AsJobPage({ params, searchParams }: Props) {
  const [{ slug }, sp, locale, profile] = await Promise.all([params, searchParams, getRequestLocale(), getProfileFromCookies()]);
  if (!SLUG_RE.test(slug)) notFound();
  // a slug that is no job at all is a missing page, whoever opens it
  if (![...(await getOccupationIndex()).values()].some((e) => e.slug === slug)) notFound();
  const forceFree = process.env.NODE_ENV !== 'production' && sp.plan === 'free';
  const owned = await ownedMap(profile, { forceFree });
  if (!owned) return <AsJobScreen view={null} locked={false} />;

  const all = await getRelated(owned.bundle.code);
  const rel = all.find((r) => r.slug === slug) ?? owned.bundle.related.find((r) => r.slug === slug);
  if (!rel) notFound();
  const { list } = await visibleRelated(owned);
  if (!list.some((r) => r.code === rel.code)) return <AsJobScreen view={null} locked />;

  const target = await loadBundle(rel.code);
  if (!target) notFound();
  const [move] = await moveViews(owned, [rel], locale);
  const [srcTexts, tgtTexts] = await Promise.all([getTaskTexts(owned.bundle.code, locale), getTaskTexts(target.code, locale)]);

  const carry = carryWeek(owned.bundle, owned.xray.shares, target);
  const then = computeXray(target, carry.shares).result.hours;
  const now = computeXray(owned.bundle, owned.xray.shares).result.hours;

  const tgtById = new Map(target.tasks.map((x) => [x.id, x]));
  const srcById = new Map(owned.bundle.tasks.map((x) => [x.id, x]));
  const tgtLabel = (id: string) => taskLabel(tgtTexts?.ready ? tgtTexts.tasks[id]?.short : null, tgtById.get(id));
  const srcLabel = (id: string) => taskLabel(srcTexts?.ready ? srcTexts.tasks[id]?.short : null, srcById.get(id));
  const hours = (share: number) => round1((share * 40) / 100);

  const week = carry.shares.flatMap((s) => {
    const task = tgtById.get(s.taskId);
    if (!task) return [];
    return [{ id: s.taskId, label: tgtLabel(s.taskId), text: tgtTexts?.tasks[s.taskId]?.text ?? task.text, share: s.share, category: task.evidence.category }];
  });
  const fresh = new Set(carry.fresh);
  const carriedTasks = carry.shares
    .filter((s) => !fresh.has(s.taskId))
    .map((s) => {
      const from = carry.pairs
        .filter((p) => p.to === s.taskId)
        .sort((a, b) => b.share - a.share)
        .map((p) => srcLabel(p.from));
      return { id: s.taskId, label: tgtLabel(s.taskId), hours: hours(s.share), from: [...new Set(from)].slice(0, 2) };
    })
    .sort((a, b) => b.hours - a.hours);
  const freshTasks = carry.shares
    .filter((s) => fresh.has(s.taskId))
    .map((s) => ({ id: s.taskId, label: tgtLabel(s.taskId), hours: hours(s.share) }))
    .sort((a, b) => b.hours - a.hours);

  const view: AsJobView = {
    move,
    xrayId: owned.xray.id,
    jobTitle: owned.xray.jobTitle,
    carried: carry.carried,
    now,
    then,
    week,
    carriedTasks,
    freshTasks,
    labelsEn: locale !== 'en' && !tgtTexts?.ready,
  };
  return <AsJobScreen view={view} locked={false} />;
}
