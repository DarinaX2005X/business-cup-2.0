import { planFirstWeek, type FirstWeekView } from '@/components/pricing/firstWeek';
import { localDay } from '@/domain/reps';
import type { Locale } from '@/domain/types';
import type { PublicProfile } from '@/lib/client/profile';
import { loadBundle } from '@/server/xray/data';
import { readXray } from '@/server/xray/records';
import { getTaskTexts } from '@/server/xray/tips';

/**
 * The first week of reps for `/pricing?from=<xrayId>`, only for the owner of that map. Uses the same
 * week the reps engine will use (the profile's own shares when this is its latest map).
 */
export async function firstWeekFor(profile: PublicProfile, xrayId: string, locale: Locale): Promise<FirstWeekView | null> {
  const xray = await readXray(xrayId).catch(() => null);
  if (!xray || xray.profileId !== profile.id) return null;
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle?.tasks.length) return null;
  const latest = xray.id === profile.lastXrayId && profile.occupationCode === xray.occupationCode && profile.shares?.length;
  const shares = latest ? profile.shares! : xray.shares;
  const texts = await getTaskTexts(bundle.code, locale).catch(() => null);
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const plan = planFirstWeek({ profileId: profile.id, tasks: bundle.tasks, shares, repLog: profile.repLog, startDay: localDay(new Date(), profile.tz) });
  return {
    xrayId: xray.id,
    jobTitle: xray.jobTitle,
    score: xray.score,
    days: plan.map((d) => {
      const task = byId.get(d.taskId);
      const tx = texts?.tasks[d.taskId];
      return { ...d, short: tx?.short ?? null, text: tx?.text ?? task?.text ?? '', category: task?.evidence.category ?? 'no_data' };
    }),
  };
}
