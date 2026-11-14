import { defaultShares } from '@/domain/shares';
import type { Category, Locale, OccupationBundle, RelatedOccupation, WeekShare, XrayResult } from '@/domain/types';
import { computeXray } from '@/domain/xray';
import { getT } from '@/i18n/server';
import { isPro, type PublicProfile } from '@/server/profile';
import { getLocalTitles, getRelated, loadBundle } from '@/server/xray/data';
import { readXray } from '@/server/xray/records';
import type { MoveView, PivotView, WeekTiles } from '@/components/pivot/types';

/**
 * Server side of /pivot and /pivot/[slug]: the visitor's latest map, the neighbours they may see and the
 * numbers each card shows, all from the data build (`getRelated`, the bundles and `computeXray`).
 * Free gets the first neighbour and the count only; locked neighbours never reach the client.
 */

export const skillKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function tilesOf(bundle: Pick<OccupationBundle, 'tasks'>, shares: readonly WeekShare[]): WeekTiles {
  const cat = new Map(bundle.tasks.map((t) => [t.id, t.evidence.category]));
  return shares.flatMap((s) => {
    const c = cat.get(s.taskId);
    return c ? [{ category: c, share: s.share }] : [];
  });
}

/** Hours by category of a week (the same rounding as the week map). */
export const hoursOf = (bundle: OccupationBundle, shares: readonly WeekShare[]): Record<Category, number> => computeXray(bundle, shares).result.hours;

export interface Owned {
  profile: PublicProfile;
  xray: XrayResult;
  bundle: OccupationBundle;
  pro: boolean;
}

/** The visitor's latest week map with its occupation, or null when there is none yet. */
export async function ownedMap(profile: PublicProfile | null, opts: { forceFree?: boolean } = {}): Promise<Owned | null> {
  if (!profile?.lastXrayId) return null;
  const xray = await readXray(profile.lastXrayId).catch(() => null);
  if (!xray || xray.profileId !== profile.id) return null;
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle) return null;
  return { profile, xray, bundle, pro: opts.forceFree ? false : isPro(profile) };
}

/** Neighbours this viewer may open: all of them on Pro, the first one on Free. */
export async function visibleRelated(owned: Owned): Promise<{ list: RelatedOccupation[]; total: number }> {
  const total = owned.bundle.relatedCount ?? owned.bundle.related.length;
  if (owned.pro) {
    const full = await getRelated(owned.bundle.code);
    return { list: full.length ? full : owned.bundle.related, total: Math.max(total, full.length) };
  }
  return { list: owned.bundle.related.slice(0, 1), total };
}

export function payKind(rel: Pick<RelatedOccupation, 'wageDelta'>, source: OccupationBundle, target: OccupationBundle | null): MoveView['pay'] {
  if (rel.wageDelta === null) return 'none';
  // Occupations that share one BLS row have one median between them: no separate figure for the move.
  if (target?.wage.soc && source.wage.soc && target.wage.soc === source.wage.soc) return 'shared';
  if (Math.abs(rel.wageDelta) < 500) return 'same';
  return rel.wageDelta > 0 ? 'more' : 'less';
}

export async function moveViews(owned: Owned, list: RelatedOccupation[], locale: Locale): Promise<MoveView[]> {
  const t = getT(locale);
  const titles = await getLocalTitles(locale).catch(() => null);
  return Promise.all(
    list.map(async (rel): Promise<MoveView> => {
      const target = await loadBundle(rel.code);
      const week = target ? defaultShares(target) : [];
      const local = titles?.get(rel.code);
      return {
        code: rel.code,
        slug: rel.slug,
        title: local ?? rel.title,
        titleEn: !local,
        similarity: rel.similarity,
        wageDelta: rel.wageDelta,
        pay: payKind(rel, owned.bundle, target),
        hours: target ? hoursOf(target, week) : { ai_does: 0, ai_speeds: 0, human_edge: rel.typicalHumanShare * 40, no_data: 0 },
        tiles: target ? tilesOf(target, week) : [],
        skills: rel.missingSkills.map((name) => {
          const key = `pivot.skill.${skillKey(name)}`;
          const label = t(key);
          return { key: skillKey(name), label: label === key ? name : label };
        }),
      };
    }),
  );
}

export async function pivotView(owned: Owned, locale: Locale): Promise<PivotView> {
  const { list, total } = await visibleRelated(owned);
  const titles = await getLocalTitles(locale).catch(() => null);
  return {
    xrayId: owned.xray.id,
    jobTitle: owned.xray.jobTitle,
    occupationTitle: titles?.get(owned.bundle.code) ?? owned.bundle.title,
    now: { hours: hoursOf(owned.bundle, owned.xray.shares), tiles: tilesOf(owned.bundle, owned.xray.shares) },
    moves: await moveViews(owned, list, locale),
    total,
    isPro: owned.pro,
  };
}
