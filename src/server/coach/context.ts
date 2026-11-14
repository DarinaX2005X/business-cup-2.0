import { localDay } from '@/domain/reps';
import type { Category, OccupationBundle, Profile, RepType } from '@/domain/types';
import { readPlan, skillsResponse } from '@/server/growth';
import { planView } from '@/server/growth/plan';
import type { PlanResponse, SkillsResponse } from '@/server/growth/types';
import { isPro } from '@/server/profile';
import { heuristicShort, loadBundle, readXray, viewXray, type XrayView } from '@/server/xray';
import { getRelated } from '@/server/xray/data';
import { tierOf, type CoachTier } from './access';
import type { CoachSnapshot } from './types';

/**
 * Everything the coach knows about the person, read from their own records on every message: the latest
 * week map (recomputed with their salary and practice), the occupation's tasks, practice log, proof,
 * streak and points, their skills and gaps, and the 90-day plan with its checks. Nothing here is
 * generated or written: the plan is only read (never started from here), and the prompt tells the model
 * that whatever is missing from this context is unknown.
 */

export const WEEK_HOURS = 40;
const TASKS_IN_CONTEXT = 14;
const RECENT_REPS = 6;
const NEXT_JOBS = 4;

export const CATEGORY_NAME: Record<Category, string> = {
  ai_does: 'AI already does it',
  ai_speeds: 'AI speeds it up',
  human_edge: 'Your human edge',
  no_data: 'No data yet',
};

export const REP_NAME: Record<RepType, string> = { slip: 'Spot the slip', delegate: 'Delegate', edge: 'Human edge' };

export interface ContextTask {
  id: string;
  label: string;
  text: string;
  hours: number;
  category: Category;
  /** People already use AI for this task at work (Anthropic Economic Index), as opposed to a research estimate. */
  seenAtWork: boolean;
  practised: number;
}

export interface CoachContext {
  tier: CoachTier;
  today: string;
  hasMap: boolean;
  jobTitle: string | null;
  occupationTitle: string | null;
  occupationCode: string | null;
  xrayId: string | null;
  score: number | null;
  baseScore: number | null;
  payAtStake: number | null;
  salary: { annual: number | null; source: 'bls_median' | 'user' | 'none' } | null;
  hours: Record<Category, number> | null;
  hoursFreed: number | null;
  tasks: ContextTask[];
  handToAi: string[];
  humanEdge: string[];
  nextJobs: { title: string; slug: string; humanShare: number; wageDelta: number | null; missingSkills: string[] }[];
  practice: {
    done: number;
    byType: Record<RepType, number>;
    avgScore: number | null;
    recent: { type: RepType; task: string; score: number; day: string }[];
    todayDone: boolean;
    trial: Profile['trial']['status'];
  };
  proof: { total: number; public: number };
  streak: { current: number; best: number; freezes: number };
  points: number;
  xp: number | null;
  level: number | null;
  /** Plain text of the person's skills and gaps, or null when there are none. */
  skills: string | null;
  skillsCount: number | null;
  /** Plain text of the 90-day plan with its checks, or null when it was not written yet. */
  plan: string | null;
  planProgress: { done: number; total: number } | null;
}

/** Skills and the 90-day plan from the growth package, read for the person's latest map. */
export interface ContextExtras {
  skills?: SkillsResponse | null;
  plan?: PlanResponse | null;
}

const hoursOf = (share: number) => Math.round(((share * WEEK_HOURS) / 100) * 10) / 10;
const unit = (s: number) => (s > 1 ? Math.min(1, s / 100) : Math.max(0, s));

export function taskLabel(task: OccupationBundle['tasks'][number]): string {
  return task.short || heuristicShort(task.text);
}

async function latestMap(profile: Profile): Promise<{ xray: XrayView; bundle: OccupationBundle } | null> {
  if (!profile.lastXrayId) return null;
  const view = await viewXray(profile.lastXrayId, profile).catch(() => null);
  if (!view?.isOwner) return null;
  const bundle = await loadBundle(view.xray.occupationCode).catch(() => null);
  return bundle ? { xray: view.xray, bundle } : null;
}

/**
 * The person's skills and their stored plan for the latest map. Read-only: a plan that was never written
 * stays absent (the coach then says it does not exist yet), and a failure leaves that part out.
 */
export async function loadExtras(profile: Profile, now = new Date()): Promise<ContextExtras> {
  if (!profile.lastXrayId) return {};
  const xray = await readXray(profile.lastXrayId).catch(() => null);
  if (!xray || xray.profileId !== profile.id) return {};
  const [skills, stored] = await Promise.all([
    skillsResponse(profile, xray).catch((err) => {
      console.warn(`[coach] skills not read: ${(err as Error).message}`);
      return null;
    }),
    readPlan(xray.id).catch(() => null),
  ]);
  let plan: PlanResponse | null = null;
  if (stored) {
    const today = localDay(now, profile.tz);
    const progress = profile.planProgress?.[xray.id] ?? { planId: stored.id, startDay: today, done: [] };
    plan = planView(stored, progress, { pro: isPro(profile, now), today, stale: false });
  }
  return { skills, plan };
}

export async function buildContext(profile: Profile, extras: ContextExtras = {}, now = new Date()): Promise<CoachContext> {
  const tier = tierOf(profile, now);
  const today = localDay(now, profile.tz);
  const map = await latestMap(profile);
  const loose = profile as Profile & { xp?: unknown; level?: unknown };

  const done = profile.repLog.filter((r): r is typeof r & { score: number } => typeof r.score === 'number' && Number.isFinite(r.score));
  const byType: Record<RepType, number> = { slip: 0, delegate: 0, edge: 0 };
  for (const r of done) byType[r.type]++;
  const practisedByTask = new Map<string, number>();
  for (const r of done) practisedByTask.set(r.taskId, (practisedByTask.get(r.taskId) ?? 0) + 1);

  let tasks: ContextTask[] = [];
  let labels = new Map<string, string>();
  let nextJobs: CoachContext['nextJobs'] = [];
  if (map) {
    const byId = new Map(map.bundle.tasks.map((t) => [t.id, t]));
    labels = new Map(map.bundle.tasks.map((t) => [t.id, taskLabel(t)]));
    tasks = [...map.xray.shares]
      .filter((s) => byId.has(s.taskId))
      .sort((a, b) => b.share - a.share)
      .slice(0, TASKS_IN_CONTEXT)
      .map((s) => {
        const t = byId.get(s.taskId)!;
        return {
          id: t.id,
          label: labels.get(t.id)!,
          text: t.text,
          hours: hoursOf(s.share),
          category: t.evidence.category,
          seenAtWork: t.evidence.evidenceLevel === 'observed',
          practised: practisedByTask.get(t.id) ?? 0,
        };
      });
    // Free and Pro previews use the first neighbour, as the public pages do; Max reads the full list.
    const related = tier === 'coach' ? await getRelated(map.bundle.code).catch(() => map.bundle.related) : map.bundle.related.slice(0, 1);
    nextJobs = (related.length ? related : map.bundle.related).slice(0, NEXT_JOBS).map((r) => ({
      title: r.title,
      slug: r.slug,
      humanShare: Math.round(r.typicalHumanShare * 100),
      wageDelta: r.wageDelta,
      missingSkills: r.missingSkills.slice(0, 5),
    }));
  }

  const recent = done
    .slice(-RECENT_REPS)
    .reverse()
    .map((r) => ({ type: r.type, task: labels.get(r.taskId) ?? 'a task from an earlier week map', score: Math.round(unit(r.score) * 100), day: r.day }));
  const avg = done.length ? Math.round((done.reduce((a, r) => a + unit(r.score), 0) / done.length) * 100) : null;

  const skills = extras.skills && !extras.skills.locked ? extras.skills : null;
  const plan = extras.plan ?? null;

  return {
    tier,
    today,
    hasMap: !!map,
    jobTitle: profile.jobTitle ?? map?.xray.jobTitle ?? null,
    occupationTitle: map?.bundle.title ?? null,
    occupationCode: map?.bundle.code ?? null,
    xrayId: map?.xray.id ?? null,
    score: map?.xray.score ?? null,
    baseScore: map?.xray.baseScore ?? null,
    payAtStake: map?.xray.payAtStake ?? null,
    salary: map ? map.xray.salary : null,
    hours: map?.xray.hours ?? null,
    hoursFreed: map?.xray.hoursFreed ?? null,
    tasks,
    handToAi: map ? map.xray.handToAi.map((id) => labels.get(id)).filter((x): x is string => !!x) : [],
    humanEdge: map ? map.xray.humanEdge.map((id) => labels.get(id)).filter((x): x is string => !!x) : [],
    nextJobs,
    practice: {
      done: done.length,
      byType,
      avgScore: avg,
      recent,
      todayDone: profile.repLog.some((r) => r.day === today && r.kind === 'daily' && typeof r.score === 'number'),
      trial: profile.trial.status,
    },
    proof: { total: profile.proof.length, public: profile.proof.filter((p) => p.public).length },
    streak: { current: profile.streak.current, best: profile.streak.best, freezes: profile.streak.freezes },
    points: profile.points.balance,
    xp: typeof loose.xp === 'number' ? loose.xp : null,
    level: typeof loose.level === 'number' ? loose.level : null,
    skills: skills ? skillsText(skills) : null,
    skillsCount: skills && skills.status === 'ready' ? skills.skills.length : null,
    plan: plan ? planText(plan) : null,
    planProgress: plan ? planCounts(plan) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Skills and plan as plain text for the prompt

const SOURCE: Record<string, string> = { resume: 'from the resume', confirmed: 'confirmed by them', added: 'added by them' };
const GAP_REASON: Record<string, string> = {
  own_job: 'their job relies on it and the resume does not show it',
  next_job: 'the jobs next to theirs need more of it',
  in_demand: 'often named in job posts for their job',
};

export function skillsText(s: SkillsResponse): string | null {
  const lines: string[] = [];
  if (s.status === 'ready' && s.skills.length) {
    lines.push(`Their skills (${s.skills.length}):`);
    for (const k of s.skills.slice(0, 24)) {
      lines.push(`- ${k.name} (${k.kind}${k.years ? `, ${k.years} years` : ''}, ${SOURCE[k.source] ?? k.source})`);
    }
  } else {
    lines.push('No skills read from a resume yet; they can add their resume on the Skills tab of the week map.');
  }
  if (s.seniorityYears) lines.push(`Years of experience in the resume: ${s.seniorityYears}.`);
  if (s.gaps.length) {
    lines.push('Skill gaps:');
    for (const g of s.gaps.slice(0, 10)) {
      lines.push(`- ${g.name}: ${GAP_REASON[g.reason] ?? g.reason}${g.leadsTo.length ? `; opens ${g.leadsTo.slice(0, 3).map((j) => j.title).join(', ')}` : ''}`);
    }
  }
  const relied = s.needs.slice(0, 8).map((n) => `${n.name}${n.shown === true ? ' (shown in resume)' : n.shown === false ? ' (not shown in resume)' : ''}`);
  if (relied.length) lines.push(`What their job relies on most: ${relied.join('; ')}.`);
  return lines.length ? lines.join('\n') : null;
}

export function planCounts(p: PlanResponse): { done: number; total: number } {
  const visible = p.weeks.filter((w) => !w.locked);
  const ids = new Set(visible.flatMap((w) => w.items.map((i) => i.id)));
  return { done: p.done.filter((id) => ids.has(id)).length, total: ids.size };
}

export function planText(p: PlanResponse): string {
  const done = new Set(p.done);
  const { done: d, total } = planCounts(p);
  const lines = [`Week ${p.currentWeek} of 12 now. ${d} of ${total} actions checked.${p.stale ? ' The week map or skills changed after the plan was written; they can refresh it on the Plan tab.' : ''}`];
  for (const w of p.weeks) {
    if (w.locked) continue;
    const near = w.n >= p.currentWeek - 1 && w.n <= p.currentWeek + 1;
    if (near) {
      lines.push(`Week ${w.n}${w.n === p.currentWeek ? ' (this week)' : ''}: ${w.focus}`);
      for (const i of w.items) lines.push(`  [${done.has(i.id) ? 'x' : ' '}] ${i.text}`);
    } else {
      const wd = w.items.filter((i) => done.has(i.id)).length;
      lines.push(`Week ${w.n}: ${w.focus} (${wd}/${w.items.length} checked)`);
    }
  }
  if (p.locked) lines.push('Only week 1 is open on their plan (the full plan comes with Pro).');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The panel beside the conversation

export function snapshotOf(ctx: CoachContext): CoachSnapshot | null {
  if (!ctx.hasMap || !ctx.xrayId || ctx.score === null || !ctx.hours) return null;
  return {
    jobTitle: ctx.jobTitle ?? ctx.occupationTitle ?? '',
    xrayId: ctx.xrayId,
    score: ctx.score,
    payAtStake: ctx.payAtStake,
    salarySource: ctx.salary?.source ?? 'none',
    hours: ctx.hours,
    tasks: ctx.tasks.slice(0, 6).map((t) => ({ id: t.id, label: t.label, hours: t.hours, category: t.category })),
    streak: ctx.streak.current,
    reps: ctx.practice.done,
    proof: ctx.proof.total,
    points: ctx.points,
    plan: ctx.planProgress,
    skills: ctx.skillsCount,
    nextJob: ctx.nextJobs[0] ? { title: ctx.nextJobs[0].title, slug: ctx.nextJobs[0].slug } : null,
  };
}
