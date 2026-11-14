import type { Category, OccupationBundle, WeekShare, WeekTask } from './types';

export const CATEGORY_ORDER: Category[] = ['ai_does', 'ai_speeds', 'human_edge', 'no_data'];
export const WEEK_HOURS = 40;

export const hoursOf = (share: number, total = WEEK_HOURS) => Math.round(share * total) / 100;

export interface WeekGroup {
  category: Category;
  tasks: WeekTask[];
  share: number;
  hours: number;
}

/** Groups tasks by category in the fixed reading order, largest task first inside a group. */
export function groupWeek(tasks: WeekTask[], total = WEEK_HOURS): WeekGroup[] {
  return CATEGORY_ORDER.map((category) => {
    const list = tasks.filter((t) => t.category === category).sort((a, b) => b.share - a.share);
    const share = list.reduce((s, t) => s + t.share, 0);
    return { category, tasks: list, share, hours: Math.round(share * total) / 100 };
  }).filter((g) => g.tasks.length > 0);
}

/** Builds Week Bar view models from a bundle, the person's shares and the short labels. */
export function weekTasksFrom(bundle: OccupationBundle, shares: WeekShare[], short: Record<string, string> = {}): WeekTask[] {
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  return shares.flatMap(({ taskId, share }) => {
    const t = byId.get(taskId);
    if (!t) return [];
    return [{ id: t.id, label: short[t.id] ?? t.text, text: t.text, share, category: t.evidence.category, evidenceLevel: t.evidence.evidenceLevel }];
  });
}
