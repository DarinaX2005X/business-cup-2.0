import { createHash, randomBytes } from 'node:crypto';
import { addDays, daysBetween } from '@/domain/reps';
import type { Category, PlanProgress, ProfileSkills, RepType, WeekShare } from '@/domain/types';
import { PLAN_WEEKS, type PlanGenerateOutput, type TaskGroup } from '@/server/ai/prompts/plan-generate';
import { coveredElements, skillKey } from './skills';
import type { GrowthPlan, PlanItem, PlanItemKind, PlanMonth, PlanResponse, PlanSummary, PlanWeek } from './types';

/*
 * Pure parts of the 90-day plan: what it is written from (and when that changed), checking the model's
 * plan against the person's real tasks and skills, the week the calendar is in, and the views.
 * I/O lives in ./service.ts.
 */

/** Bump when the prompt or the checks change in a way that should rewrite stored plans. */
export const PLAN_VERSION = 1;
export const ITEMS_MIN = 3;
export const ITEMS_MAX = 5;
export const TEXT_MAX = 160;
export const FOCUS_MAX = 70;

export const monthOf = (week: number): PlanMonth => (week <= 4 ? 1 : week <= 8 ? 2 : 3);

export const GROUP: Record<Category, TaskGroup> = { ai_does: 'AI_DOES', ai_speeds: 'AI_SPEEDS', human_edge: 'HUMAN', no_data: 'UNKNOWN' };

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function newPlanId(): string {
  let out = '';
  for (const b of randomBytes(16)) if (b < 248 && out.length < 8) out += BASE62[b % 62];
  return out;
}

/**
 * What the plan is written from: the week (tasks and their shares) and the skills (names the person has
 * and the O*NET elements they show). A different key means the plan no longer matches their data.
 */
export function planInputsKey(input: { occupationCode: string; shares: readonly WeekShare[]; skills: ProfileSkills | undefined }): string {
  const shares = [...input.shares].map((s) => `${s.taskId}:${s.share}`).sort();
  const names = (input.skills?.items ?? []).map((i) => skillKey(i.name)).sort();
  const shown = [...coveredElements(input.skills)].sort();
  const payload = JSON.stringify({ v: PLAN_VERSION, code: input.occupationCode, shares, names, shown });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

// ---------------------------------------------------------------------------------------------
// Checking the model's plan

export interface PlanCheckContext {
  planId: string;
  /** First week written (1, or the week a refresh starts from). */
  fromWeek: number;
  /** The person's week: task id → name and group. */
  tasks: ReadonlyMap<string, { label: string; category: Category }>;
  /** Skills the plan may build: gap ids and the person's own skill ids → the name shown. */
  skills: ReadonlyMap<string, string>;
}

export interface PlanCheck {
  weeks: PlanWeek[];
  /** The plan cannot be used (a week without enough real actions, wrong number of weeks). */
  fatal: string[];
  /** Worth one more try, but usable (a missing rep type, no Review kit milestone). */
  soft: string[];
  /** Actions left out (a task outside the week, an invented figure …); harmless while every week keeps enough. */
  dropped: string[];
}

const PLACEHOLDER = /\{(\w+)\}/g;
const BANNED = /%|\$|https?:\/\/|www\.|!/;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

function fill(template: string, task: string | null, skill: string | null): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => (name === 'task' && task ? task : name === 'skill' && skill ? skill : whole));
}

const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]);

export function checkPlan(out: PlanGenerateOutput, ctx: PlanCheckContext): PlanCheck {
  const fatal: string[] = [];
  const soft: string[] = [];
  const dropped: string[] = [];
  const expected = PLAN_WEEKS - ctx.fromWeek + 1;
  const sorted = [...out.weeks].sort((a, b) => a.week - b.week);
  if (sorted.length !== expected) {
    fatal.push(`Return exactly ${expected} weeks (got ${sorted.length}).`);
    return { weeks: [], fatal, soft, dropped };
  }
  const numbered = sorted.every((w, i) => w.week === ctx.fromWeek + i);
  if (!numbered) soft.push(`Number the weeks ${ctx.fromWeek} to ${PLAN_WEEKS} in order.`);

  const seen = new Set<string>();
  const weeks: PlanWeek[] = [];
  const repTypes = new Set<RepType>();

  sorted.forEach((w, wi) => {
    const n = ctx.fromWeek + wi;
    // Focus: plain words, {task} only with a real focusTaskId.
    let focusTaskId: string | null = null;
    let focusTemplate = tidy(w.focus);
    const fph = placeholders(focusTemplate);
    if (fph.includes('task')) {
      const tid = w.focusTaskId?.trim() ?? '';
      if (ctx.tasks.has(tid)) focusTaskId = tid;
      else {
        soft.push(`Week ${n}: focus uses {task} without a taskId from their week.`);
        focusTemplate = focusTemplate.replace(/\s*\{task\}\s*/g, ' ').trim();
      }
    }
    if (fph.some((p) => p !== 'task')) {
      soft.push(`Week ${n}: focus may only use {task}.`);
      focusTemplate = focusTemplate.replace(/\{(?!task\})\w+\}/g, '').replace(/\s+/g, ' ').trim();
    }
    let focus = fill(focusTemplate, focusTaskId ? ctx.tasks.get(focusTaskId)!.label : null, null);
    if (BANNED.test(focus)) focus = focus.replace(/!/g, '');
    if (focus.length < 3 || focus.length > FOCUS_MAX) {
      fatal.push(`Week ${n}: focus must be 3 to 8 plain words.`);
      focus = focus.slice(0, FOCUS_MAX);
    }

    const items: PlanItem[] = [];
    w.items.forEach((it, ii) => {
      const where = `Week ${n}, action ${ii + 1}`;
      const template = tidy(it.text);
      const ph = placeholders(template);
      const taskId = it.taskId?.trim() || null;
      const skillId = it.skillId?.trim() || null;
      const task = taskId ? ctx.tasks.get(taskId) : undefined;
      const skillName = skillId ? ctx.skills.get(skillId) : undefined;
      const drop = (why: string) => dropped.push(`${where}: ${why}`);

      if (ph.some((p) => p !== 'task' && p !== 'skill')) return drop('only {task} and {skill} placeholders are allowed.');
      if (BANNED.test(template)) return drop('no percentages, prices, links or exclamation marks.');
      if (template.length < 10) return drop('the text is too short.');
      const kind: PlanItemKind = it.kind;
      if (ph.includes('task') && !task) return drop(`taskId ${taskId ?? 'null'} is not a task of their week.`);
      if (ph.includes('skill') && !skillName) return drop(`skillId ${skillId ?? 'null'} is not in the skill lists.`);

      let repType: RepType | null = null;
      if (kind === 'rep') {
        if (!task || !ph.includes('task')) return drop('a rep needs a taskId from their week and {task} in the text.');
        if (!it.repType) return drop('a rep needs a repType.');
        repType = it.repType;
      } else if (kind === 'work') {
        if (!task || !ph.includes('task')) return drop('a work action needs a taskId from their week and {task} in the text.');
      } else if (kind === 'skill') {
        if (!skillName || !ph.includes('skill')) return drop('a skill action needs a skillId from the lists and {skill} in the text.');
      } else if (kind === 'review') {
        if (ph.length) return drop('a review action has no placeholders.');
      }

      const useTask = ph.includes('task') ? taskId : null;
      const text = fill(template, useTask ? task!.label : null, ph.includes('skill') ? skillName! : null);
      if (text.length > TEXT_MAX) return drop(`keep the text under 120 characters.`);
      const key = text.toLowerCase();
      if (seen.has(key)) return drop('this action repeats an earlier one.');
      if (items.length >= ITEMS_MAX) return drop(`at most ${ITEMS_MAX} actions a week.`);
      seen.add(key);
      if (repType) repTypes.add(repType);
      items.push({
        id: `${ctx.planId}-${n}-${items.length + 1}`,
        kind,
        text,
        template,
        taskId: useTask,
        taskLabel: useTask ? task!.label : null,
        category: useTask ? task!.category : null,
        repType,
        skillId: ph.includes('skill') ? skillId : null,
        skillName: ph.includes('skill') ? skillName! : null,
      });
    });

    if (items.length < ITEMS_MIN) fatal.push(`Week ${n} has ${items.length} usable actions; it needs ${ITEMS_MIN} to ${ITEMS_MAX}.`, ...dropped.filter((d) => d.startsWith(`Week ${n},`)));
    if (!items.some((i) => i.kind === 'rep')) soft.push(`Week ${n} has no rep.`);
    weeks.push({ n, month: monthOf(n), focus, focusTaskId, items });
  });

  if (ctx.fromWeek === 1) {
    for (const t of ['slip', 'delegate', 'edge'] as const) if (!repTypes.has(t)) soft.push(`Use the ${t} rep type at least once.`);
  }
  if (ctx.fromWeek <= 12 && !weeks.some((w) => w.n >= 9 && w.items.some((i) => i.kind === 'review'))) {
    soft.push('Add a Review kit milestone in week 11 or 12.');
  }
  return { weeks, fatal, soft, dropped };
}

// ---------------------------------------------------------------------------------------------
// Calendar

/** The week the calendar is in: week 1 starts on `startDay`, capped at 12. */
export function currentWeekOf(startDay: string, today: string): number {
  const days = daysBetween(startDay, today);
  if (!Number.isFinite(days) || days < 0) return 1;
  return Math.min(PLAN_WEEKS, Math.floor(days / 7) + 1);
}

export const weekStartDay = (startDay: string, n: number) => addDays(startDay, (n - 1) * 7);

/** A refresh keeps the weeks already under way: those before the current one, and the current one once anything in it is checked. */
export function keptWeeks(plan: GrowthPlan, progress: PlanProgress | undefined, currentWeek: number): number {
  const done = new Set(progress?.done.map((d) => d.id) ?? []);
  const current = plan.weeks.find((w) => w.n === currentWeek);
  const startedCurrent = current?.items.some((i) => done.has(i.id)) ?? false;
  return Math.min(PLAN_WEEKS - 1, startedCurrent ? currentWeek : currentWeek - 1);
}

export function mergeRefresh(old: GrowthPlan, fresh: PlanWeek[], keep: number): PlanWeek[] {
  return [...old.weeks.filter((w) => w.n <= keep), ...fresh.filter((w) => w.n > keep)].sort((a, b) => a.n - b.n);
}

// ---------------------------------------------------------------------------------------------
// Views

export function itemIndex(plan: Pick<GrowthPlan, 'weeks'>): Map<string, { item: PlanItem; week: number }> {
  const m = new Map<string, { item: PlanItem; week: number }>();
  for (const w of plan.weeks) for (const item of w.items) m.set(item.id, { item, week: w.n });
  return m;
}

/** Free sees week 1; the rest come as locked shells (number and month only). */
export function planView(plan: GrowthPlan, progress: PlanProgress, opts: { pro: boolean; today: string; stale: boolean }): PlanResponse {
  const ids = itemIndex(plan);
  const done = progress.done.map((d) => d.id).filter((id) => ids.has(id) && (opts.pro || ids.get(id)!.week === 1));
  return {
    status: 'ready',
    locked: !opts.pro,
    xrayId: plan.xrayId,
    planId: plan.id,
    jobTitle: plan.jobTitle,
    currentWeek: currentWeekOf(progress.startDay, opts.today),
    startDay: progress.startDay,
    weeks: plan.weeks.map((w) => (opts.pro || w.n === 1 ? w : { n: w.n, month: w.month, focus: '', focusTaskId: null, items: [], locked: true })),
    done,
    stale: opts.stale,
    createdAt: plan.createdAt,
  };
}

export function planSummary(plan: GrowthPlan | null, progress: PlanProgress | undefined, opts: { pro: boolean; today: string; xrayId: string | null }): PlanSummary {
  if (!plan || !progress) {
    return { status: 'none', xrayId: opts.xrayId, currentWeek: 1, weekDone: 0, weekTotal: 0, totalDone: 0, total: 0, next: null, locked: !opts.pro };
  }
  const view = planView(plan, progress, { pro: opts.pro, today: opts.today, stale: false });
  // Free reads its one open week; Pro reads the week the calendar is in.
  const shownWeek = opts.pro ? view.currentWeek : 1;
  const week = plan.weeks.find((w) => w.n === shownWeek);
  const done = new Set(view.done);
  const weekItems = week?.items ?? [];
  const next = weekItems.find((i) => !done.has(i.id)) ?? null;
  const visible = opts.pro ? plan.weeks : plan.weeks.filter((w) => w.n === 1);
  return {
    status: 'ready',
    xrayId: plan.xrayId,
    currentWeek: shownWeek,
    weekDone: weekItems.filter((i) => done.has(i.id)).length,
    weekTotal: weekItems.length,
    totalDone: view.done.length,
    total: visible.reduce((n, w) => n + w.items.length, 0),
    next: next ? { id: next.id, text: next.text } : null,
    locked: !opts.pro,
  };
}
