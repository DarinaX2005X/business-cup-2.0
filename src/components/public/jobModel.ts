import { defaultShares } from '@/domain/shares';
import { computeXray } from '@/domain/xray';
import type { OccTask, OccupationBundle } from '@/domain/types';
import { getT } from '@/i18n/messages';
import { possessive, singularPhrase, taskShort } from './text';

/** Everything a public job page shows, computed from the bundle (typical week, no personal data). */
export function jobModel(bundle: OccupationBundle) {
  const t = getT('en');
  const shares = defaultShares(bundle);
  const { result } = computeXray(bundle, shares);
  const byId = new Map(bundle.tasks.map((task) => [task.id, task]));
  const week = shares
    .map((s) => ({ task: byId.get(s.taskId)!, share: s.share }))
    .filter((r) => r.task)
    .sort((a, b) => b.share - a.share);
  const inWeek = new Set(shares.map((s) => s.taskId));
  const others: OccTask[] = bundle.tasks.filter((task) => !inWeek.has(task.id));

  const ai = result.percent.ai_does + result.percent.ai_speeds;
  const humanTasks = week.filter((r) => r.task.evidence.category === 'human_edge').slice(0, 2);
  // Mid-sentence labels start lower-case unless they open with an acronym («HVAC checks»).
  const labels = humanTasks.map((r) => {
    const s = taskShort(r.task);
    return /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1);
  });
  const human = labels.length === 2 ? t('jobs.page.and', { a: labels[0], b: labels[1] }) : labels[0] ?? '';

  const singular = singularPhrase(bundle.title);
  const who = singular ? possessive(singular) : null;
  const h1 = who ? t('jobs.page.h1', { who }) : t('jobs.page.h1Plain', { title: bundle.title });
  const metaTitle = who ? t('jobs.page.metaTitle', { who }) : t('jobs.page.metaTitlePlain', { title: bundle.title });
  const summary = [
    t('jobs.page.summaryAi', { ai }),
    human ? t('jobs.page.summaryHuman', { human }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const description = t('jobs.page.metaDescription', { ai, title: bundle.title });

  return { result, week, others, ai, h1, metaTitle, summary, description };
}
