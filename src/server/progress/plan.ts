import { addDays, daysBetween, localDay } from '@/domain/reps';
import type { Category, OccTask, Profile, RelatedOccupation, RepType, WeekShare, XrayResult } from '@/domain/types';
import { HttpError } from '@/server/profile/http';
import { loadBundle, readXray } from '@/server/xray';
import { getRelated } from '@/server/xray/data';
import { doneReps, unitScore } from './core';
import { taskLabels } from './history';
import type { Phrase, PlanMonth, PlanResponse, PlanWeek } from './types';

/**
 * The 90-day plan (05.1.4): three months of four weeks built from the person's own week map, by code and
 * dictionary templates, no model. Month 1 «Hand off» (tasks AI already does: Delegate, then Spot the slip),
 * month 2 «Supervise» (tasks AI speeds up: Spot the slip), month 3 «Grow your edge» (human edge tasks:
 * Human edge, a skill of the nearest neighbouring job, and the review brief).
 */

export const PLAN_WEEKS = 12;

interface PlanTask {
  id: string;
  category: Category;
  share: number;
  importance: number;
}

/** Tasks of the week in a category, biggest share first. */
function pick(tasks: readonly PlanTask[], cats: Category[]): PlanTask[] {
  return tasks.filter((t) => cats.includes(t.category)).sort((a, b) => b.share - a.share || b.importance - a.importance);
}

/** First non-empty list, else every task by share. */
function firstOf(all: readonly PlanTask[], ...lists: PlanTask[][]): PlanTask[] {
  return lists.find((l) => l.length) ?? [...all].sort((a, b) => b.share - a.share);
}

const at = <T>(list: readonly T[], i: number): T => list[i % list.length];

interface Draft {
  focus: Phrase;
  taskIds: string[];
  repType: RepType | null;
}

/** The twelve weeks as templates and task ids (pure). `labels` give the task names for the phrases. */
export function planWeeks(tasks: readonly PlanTask[], related: Pick<RelatedOccupation, 'title' | 'missingSkills'> | null): { key: PlanMonth['key']; weeks: Draft[] }[] {
  const handoff = firstOf(tasks, pick(tasks, ['ai_does']), pick(tasks, ['ai_speeds']));
  // Month 2 starts with tasks month 1 did not already cover.
  const used = new Set(handoff.slice(0, 2).map((t) => t.id));
  const speeds = firstOf(tasks, pick(tasks, ['ai_speeds']), pick(tasks, ['ai_does']));
  const supervise = [...speeds.filter((t) => !used.has(t.id)), ...speeds.filter((t) => used.has(t.id))];
  const edge = firstOf(tasks, pick(tasks, ['human_edge']), pick(tasks, ['no_data']));
  const w = (key: string, task: PlanTask | null, repType: RepType | null, extra: Record<string, string> = {}): Draft => ({
    focus: { key: `progress.plan.focus.${key}`, params: { ...(task ? { task: task.id } : {}), ...extra } },
    taskIds: task ? [task.id] : [],
    repType,
  });
  const skill = related?.missingSkills[0];
  return [
    {
      key: 'handoff',
      weeks: [
        w('handDelegate', at(handoff, 0), 'delegate'),
        w('handSlip', at(handoff, 0), 'slip'),
        w('handDelegate', at(handoff, 1), 'delegate'),
        w('handSlip', at(handoff, 1), 'slip'),
      ],
    },
    {
      key: 'supervise',
      // With fewer than four tasks, the last week hands the first one to AI end to end instead of repeating it.
      weeks: [0, 1, 2, 3].map((i) => (i === 3 && supervise.length < 4 ? w('superviseDelegate', at(supervise, 0), 'delegate') : w('superviseSlip', at(supervise, i), 'slip'))),
    },
    {
      key: 'edge',
      weeks: [
        w('edge', at(edge, 0), 'edge'),
        w('edge', at(edge, 1), 'edge'),
        skill && related ? w('skill', null, null, { skill, job: related.title }) : w('edge', at(edge, 2), 'edge'),
        w('review', null, null),
      ],
    },
  ];
}

/** Assembles weeks with dates and the reps done in each (pure). `start` is the plan's first day. */
export function assemblePlan(
  drafts: ReturnType<typeof planWeeks>,
  start: string,
  today: string,
  log: Profile['repLog'],
  labels: Map<string, string>,
): Omit<PlanResponse, 'xrayId' | 'tasks'> {
  const reps = doneReps(log);
  let n = 0;
  const months: PlanMonth[] = drafts.map((m) => ({
    key: m.key,
    weeks: m.weeks.map((d): PlanWeek => {
      const from = addDays(start, 7 * n);
      const to = addDays(from, 6);
      n += 1;
      const focus = d.focus.params.task ? { key: d.focus.key, params: { ...d.focus.params, task: labels.get(String(d.focus.params.task)) ?? '' } } : d.focus;
      return {
        n,
        focus,
        taskIds: d.taskIds,
        repType: d.repType,
        start: from,
        end: to,
        done: reps
          .filter((r) => r.day >= from && r.day <= to)
          .map((r) => ({
            repId: r.id,
            type: r.type,
            taskId: r.taskId,
            taskShort: labels.get(r.taskId) ?? '',
            score: Math.round(unitScore(r.score) * 100),
            day: r.day,
            onFocus: d.taskIds.includes(r.taskId) && (d.repType === null || d.repType === r.type),
          })),
      };
    }),
  }));
  const current = Math.max(0, Math.min(PLAN_WEEKS, Math.floor(daysBetween(start, today) / 7)));
  return { start, current, months };
}

/** GET /api/plan: the plan of the latest week map. 409 without a map. */
export async function buildPlan(profile: Profile, opts: { tz?: string | null; now?: Date; locale?: Profile['locale'] } = {}): Promise<PlanResponse> {
  const xray: XrayResult | null = profile.lastXrayId ? await readXray(profile.lastXrayId).catch(() => null) : null;
  if (!xray || xray.profileId !== profile.id) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle) throw new HttpError(409, 'no_xray', 'The occupation of this week map is no longer in the data.');
  const tz = profile.tz ?? opts.tz ?? null;
  const today = localDay(opts.now ?? new Date(), tz);
  const start = localDay(new Date(xray.createdAt), tz);
  const tasks = planTasks(xray.shares, bundle.tasks);
  if (!tasks.length) throw new HttpError(409, 'no_xray', 'This week map has no tasks.');
  const related = (await getRelated(bundle.code).catch(() => []))[0] ?? bundle.related[0] ?? null;
  const labels = (await taskLabels([bundle.code], opts.locale ?? profile.locale)).get(bundle.code) ?? new Map<string, string>();
  const plan = assemblePlan(planWeeks(tasks, related), start, today, profile.repLog.filter((r) => labels.has(r.taskId)), labels);
  const used = new Set(plan.months.flatMap((m) => m.weeks.flatMap((w) => [...w.taskIds, ...w.done.map((d) => d.taskId)])));
  return { xrayId: xray.id, ...plan, tasks: Object.fromEntries([...used].map((id) => [id, labels.get(id) ?? ''])) };
}

export function planTasks(shares: readonly WeekShare[], tasks: readonly OccTask[]): PlanTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return shares.flatMap((s) => {
    const t = byId.get(s.taskId);
    return t ? [{ id: t.id, category: t.evidence.category, share: s.share, importance: t.importance ?? 0 }] : [];
  });
}
