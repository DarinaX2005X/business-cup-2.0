import { randomBytes } from 'node:crypto';
import { localDay } from '@/domain/reps';
import type { Profile, XrayResult } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { AiError, callModel } from '@/server/ai/client';
import { planGeneratePrompt, planGenerateSchema, type PlanPromptInput } from '@/server/ai/prompts/plan-generate';
import { profileSkillsPrompt, profileSkillsSchema } from '@/server/ai/prompts/profile-skills';
import { emit } from '@/server/events';
import { getProfile, isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';
import { getRelated, loadBundle } from '@/server/xray/data';
import { readXray } from '@/server/xray/records';
import { getTaskTexts, heuristicShort } from '@/server/xray/tips';
import {
  checkPlan,
  currentWeekOf,
  GROUP,
  itemIndex,
  keptWeeks,
  mergeRefresh,
  newPlanId,
  planInputsKey,
  planSummary,
  planView,
} from './plan';
import {
  applyRead,
  cleanText,
  computeGaps,
  coveredElements,
  elementsToCheck,
  gapLabel,
  gapWhat,
  jobNeeds,
  patchSkills,
  SkillsPatchError,
  sortSkills,
  textHash,
  verifyRead,
  viewSkill,
} from './skills';
import { technologiesFor } from './technology';
import type { GrowthPlan, PlanCheckResponse, PlanPending, PlanResponse, PlanSummary, PlanWeek, SkillGap, SkillsPatch, SkillsResponse } from './types';

/*
 * The growth core's I/O: reading skills from a résumé text, the person's edits, gaps for their map, and
 * the 90-day plan (written once per map and stored as `growth:plan:<xrayId>`, rewritten from the current
 * week when the map or the skills change). Progress and skills live on the profile.
 */

export const planKey = (xrayId: string) => `growth:plan:${xrayId}`;
const lockKey = (xrayId: string) => `growth:planlock:${xrayId}`;
const LOCK_TTL_SEC = 150;
/** Fewer words than this cannot hold a work history. */
const MIN_WORDS = 8;

const today = (profile: Pick<Profile, 'tz'>, tz?: string | null) => localDay(new Date(), tz ?? profile.tz);

/** The person's own map: the given id, or their latest. 404 for someone else's, 409 when there is none. */
export async function ownXray(profile: Profile, xrayId?: string | null): Promise<XrayResult> {
  const id = xrayId || profile.lastXrayId;
  if (!id) throw new HttpError(409, 'no_xray', 'Make a week map first.');
  const xray = await readXray(id);
  if (!xray || xray.profileId !== profile.id) throw new HttpError(404, 'not_found', 'Week map not found.');
  return xray;
}

async function requireBundle(code: string) {
  const bundle = await loadBundle(code);
  if (!bundle) throw new HttpError(404, 'not_found', `occupation ${code} not found`);
  return bundle;
}

// ---------------------------------------------------------------------------------------------
// Skills

export async function skillsResponse(profile: Profile, xray: XrayResult): Promise<SkillsResponse> {
  const pro = isPro(profile);
  const bundle = await requireBundle(xray.occupationCode);
  const techs = technologiesFor(bundle.code);
  const skills = profile.skills;
  const items = sortSkills((skills?.items ?? []).map((i) => viewSkill(i, techs)));
  const covered = coveredElements(skills);
  const known = pro && items.length > 0;
  const related = pro && items.length ? await getRelated(bundle.code) : [];
  return {
    locked: !pro,
    occupation: { code: bundle.code, title: bundle.title, jobTitle: xray.jobTitle },
    xrayId: xray.id,
    status: items.length ? 'ready' : 'empty',
    skills: pro ? items : [],
    count: items.length,
    needs: jobNeeds(bundle).map((n) => ({ ...n, shown: known ? covered.has(n.id) : null })),
    gaps: known ? computeGaps({ bundle, related, techs, skills }) : [],
    seniorityYears: pro ? (skills?.seniorityYears ?? null) : null,
    otherOccupation: Boolean(skills?.occupationCode && skills.occupationCode !== bundle.code),
    extractedAt: skills?.extractedAt ?? null,
  };
}

/**
 * Reads skills from a résumé or work description (the résumé path calls this right after the map is
 * saved; the Skills tab calls it when the person pastes a text). The text is checked and forgotten:
 * only the skills, short verified quotes and a hash of the text are kept.
 */
export async function extractSkills(input: { profile: Profile; text: string; xrayId?: string | null; actor?: Actor }): Promise<SkillsResponse> {
  const { profile } = input;
  const text = cleanText(input.text);
  const words = text.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  if (words.length < MIN_WORDS) throw new HttpError(422, 'too_short', 'Paste at least a few lines about your work.');
  const xray = await ownXray(profile, input.xrayId);
  const bundle = await requireBundle(xray.occupationCode);
  const related = await getRelated(bundle.code);
  const elements = elementsToCheck(bundle, related);
  const techs = technologiesFor(bundle.code);

  const { data } = await callModel({
    op: 'profile.skills',
    schema: profileSkillsSchema,
    system: profileSkillsPrompt.system(),
    user: profileSkillsPrompt.user({ occupation: bundle.title, elements, text }),
    locale: 'en',
    // no cache: the résumé is read for this request only
    maxTokens: 5000,
    temperature: 0,
    actor: input.actor,
  });
  const read = verifyRead(data, text, elements, techs);
  if (read.dropped.length) {
    const why = read.dropped.reduce<Record<string, number>>((m, d) => ({ ...m, [d.why]: (m[d.why] ?? 0) + 1 }), {});
    console.info(`[growth] profile.skills kept=${read.items.length} shown=${read.shown.length} dropped=${JSON.stringify(why)}`);
  }
  if (!read.isWorkText || (!read.items.length && !read.shown.length)) {
    throw new HttpError(422, 'not_work', 'The text does not show work skills we can read.');
  }
  const now = new Date().toISOString();
  const hash = textHash(text);
  const { profile: next } = await updateProfile(
    profile.id,
    (p) => {
      p.skills = applyRead(p.skills, read, { occupationCode: bundle.code, textHash: hash, now });
    },
    { current: profile },
  );
  return skillsResponse(next, xray);
}

export async function editSkills(profile: Profile, patch: SkillsPatch, xrayId?: string | null): Promise<SkillsResponse & { item: { id: string; name: string } | null }> {
  if (!isPro(profile)) throw new HttpError(402, 'pro_required', 'Skills are part of Pro.');
  const xray = await ownXray(profile, xrayId);
  const techs = technologiesFor(xray.occupationCode);
  let item: { id: string; name: string } | null = null;
  const now = new Date().toISOString();
  try {
    const { profile: next } = await updateProfile(
      profile.id,
      (p) => {
        const res = patchSkills(p.skills, patch, { now, techs });
        p.skills = res.skills;
        item = res.item ? { id: res.item.id, name: res.item.name } : null;
      },
      { current: profile },
    );
    return { ...(await skillsResponse(next, xray)), item };
  } catch (err) {
    if (err instanceof SkillsPatchError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'limit' ? 409 : 400;
      throw new HttpError(status, err.code, err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Plan

export async function readPlan(xrayId: string): Promise<GrowthPlan | null> {
  const hit = await getStore().get<GrowthPlan>(planKey(xrayId));
  return hit?.value ?? null;
}

const REASON: Record<SkillGap['reason'], string> = {
  own_job: 'their job relies on it a lot',
  next_job: 'the jobs next to theirs need more of it',
  in_demand: 'often named in job posts for their job',
};

interface PlanContext {
  input: Omit<PlanPromptInput, 'fromWeek' | 'problems'>;
  tasks: Map<string, { label: string; category: import('@/domain/types').Category; human?: boolean }>;
  skills: Map<string, string>;
  inputsKey: string;
}

async function planContext(profile: Profile, xray: XrayResult): Promise<PlanContext> {
  const bundle = await requireBundle(xray.occupationCode);
  const texts = await getTaskTexts(bundle.code, 'en');
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const tasks = new Map<string, { label: string; category: import('@/domain/types').Category; human?: boolean }>();
  const promptTasks: PlanPromptInput['tasks'] = [];
  for (const s of [...xray.shares].sort((a, b) => b.share - a.share)) {
    const t = byId.get(s.taskId);
    if (!t) continue;
    // Generated labels when ready, else the bundle's model-written label, else a cut of the O*NET text.
    const label = (texts?.ready ? texts.tasks[t.id]?.short : null) || t.short || heuristicShort(t.text);
    // people work, hands-on work and the human group are never handed to AI in the plan
    const human = Boolean(t.evidence.peopleWork || t.evidence.physical || t.evidence.category === 'human_edge');
    tasks.set(t.id, { label, category: t.evidence.category, human });
    promptTasks.push({ id: t.id, label, hours: Math.round(((s.share * 40) / 100) * 2) / 2, group: GROUP[t.evidence.category], text: t.text, human });
  }
  const related = await getRelated(bundle.code);
  const techs = technologiesFor(bundle.code);
  const gaps = computeGaps({ bundle, related, techs, skills: profile.skills });
  const own = (profile.skills?.items ?? [])
    .slice()
    .sort((a, b) => Number(b.source !== 'resume') - Number(a.source !== 'resume') || (b.years ?? 0) - (a.years ?? 0))
    .slice(0, 12);
  const skills = new Map<string, string>();
  for (const g of gaps) skills.set(g.id, gapLabel(g));
  for (const s of own) skills.set(s.id, s.name);
  const practice = { slip: 0, delegate: 0, edge: 0 };
  for (const r of profile.repLog) if (r.score !== undefined) practice[r.type]++;
  return {
    input: {
      jobTitle: xray.jobTitle,
      occupation: bundle.title,
      tasks: promptTasks,
      skills: own.map((s) => ({ id: s.id, name: s.name })),
      gaps: gaps.map((g) => ({
        id: g.id,
        name: gapLabel(g),
        what: gapWhat(g),
        why: g.leadsTo.length ? `${REASON[g.reason]}; opens ${g.leadsTo.slice(0, 3).map((j) => j.title).join(', ')}` : REASON[g.reason],
      })),
      practice,
    },
    tasks,
    skills,
    inputsKey: planInputsKey({ occupationCode: bundle.code, shares: xray.shares, skills: profile.skills }),
  };
}

/** One model call, the code checks, and one repair round with the problems listed. */
async function writeWeeks(ctx: PlanContext, planId: string, fromWeek: number, actor: Actor | undefined): Promise<PlanWeek[]> {
  let problems: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await callModel({
      op: 'plan.generate',
      schema: planGenerateSchema,
      system: planGeneratePrompt.system(),
      user: planGeneratePrompt.user({ ...ctx.input, fromWeek, problems }),
      locale: 'en',
      maxTokens: 9000,
      temperature: 0.4,
      actor,
    });
    const check = checkPlan(data, { planId, fromWeek, tasks: ctx.tasks, skills: ctx.skills });
    if (check.dropped.length) console.info(`[growth] plan.generate attempt=${attempt + 1} dropped=${check.dropped.length}: ${check.dropped.slice(0, 3).join(' | ')}`);
    if (!check.fatal.length && (!check.soft.length || attempt === 1)) return check.weeks;
    problems = [...check.fatal, ...check.soft].slice(0, 24);
    console.info(`[growth] plan.generate attempt=${attempt + 1} fatal=${check.fatal.length} soft=${check.soft.length}: ${problems.slice(0, 4).join(' | ')}`);
  }
  throw new AiError('invalid_output', 'the plan failed the checks twice', { op: 'plan.generate' });
}

async function withLock<T>(xrayId: string, fn: () => Promise<T>): Promise<T | null> {
  const store = getStore();
  const token = randomBytes(8).toString('hex');
  if (!(await store.setNx(lockKey(xrayId), token, LOCK_TTL_SEC))) return null;
  try {
    return await fn();
  } finally {
    await store.delIfEquals(lockKey(xrayId), token).catch(() => undefined);
  }
}

/**
 * GET /api/plan: the stored plan (marked stale when the map or skills changed since), or a new one
 * written now. A second request while one is being written gets `generating` and asks again.
 */
export async function getPlan(input: { profile: Profile; xrayId?: string | null; actor?: Actor; tz?: string | null; generate?: boolean }): Promise<PlanResponse | PlanPending> {
  const { profile } = input;
  const xray = await ownXray(profile, input.xrayId);
  const pro = isPro(profile);
  const day = today(profile, input.tz);
  const stored = await readPlan(xray.id);
  if (stored) {
    const ctxKey = planInputsKey({ occupationCode: xray.occupationCode, shares: xray.shares, skills: profile.skills });
    const progress = await syncProgress(profile, stored, day);
    return planView(stored, progress, { pro, today: day, stale: stored.inputsKey !== ctxKey });
  }
  if (input.generate === false) throw new HttpError(404, 'no_plan', 'No plan has been written for this map yet.');
  const made = await withLock(xray.id, async () => {
    const again = await readPlan(xray.id);
    if (again) return again;
    const ctx = await planContext(profile, xray);
    const id = newPlanId();
    const weeks = await writeWeeks(ctx, id, 1, input.actor);
    const plan: GrowthPlan = {
      id,
      xrayId: xray.id,
      profileId: profile.id,
      occupationCode: xray.occupationCode,
      jobTitle: xray.jobTitle,
      inputsKey: ctx.inputsKey,
      weeks,
      createdAt: new Date().toISOString(),
    };
    // the profile (or the map) may have been deleted while the plan was written: store nothing then
    const [owner, map] = await Promise.all([getProfile(profile.id), readXray(xray.id)]);
    if (!owner || !map || map.profileId !== profile.id) throw new HttpError(404, 'not_found', 'Week map not found.');
    await getStore().set(planKey(xray.id), plan);
    return plan;
  });
  if (!made) return { status: 'generating', xrayId: xray.id };
  const progress = await syncProgress(profile, made, day);
  return planView(made, progress, { pro, today: day, stale: false });
}

/** Progress follows the plan: a new plan keeps the start day and the checks of the weeks it kept. */
async function syncProgress(profile: Profile, plan: GrowthPlan, day: string) {
  const current = profile.planProgress?.[plan.xrayId];
  if (current && current.planId === plan.id) return current;
  const ids = itemIndex(plan);
  const { profile: next } = await updateProfile(profile.id, (p) => {
    const prev = p.planProgress?.[plan.xrayId];
    if (prev?.planId === plan.id) return;
    p.planProgress = {
      ...(p.planProgress ?? {}),
      [plan.xrayId]: { planId: plan.id, startDay: prev?.startDay ?? day, done: (prev?.done ?? []).filter((d) => ids.has(d.id)) },
    };
  });
  return next.planProgress![plan.xrayId];
}

/** POST /api/plan { xray, refresh }: rewrites the plan from the current week when it is stale. */
export async function refreshPlan(input: { profile: Profile; xrayId?: string | null; actor?: Actor; tz?: string | null }): Promise<PlanResponse | PlanPending> {
  const { profile } = input;
  const xray = await ownXray(profile, input.xrayId);
  const stored = await readPlan(xray.id);
  if (!stored) return getPlan(input);
  const pro = isPro(profile);
  const day = today(profile, input.tz);
  const ctx = await planContext(profile, xray);
  if (stored.inputsKey === ctx.inputsKey) {
    const progress = await syncProgress(profile, stored, day);
    return planView(stored, progress, { pro, today: day, stale: false });
  }
  const made = await withLock(xray.id, async () => {
    const latest = (await readPlan(xray.id)) ?? stored;
    const progress = profile.planProgress?.[xray.id];
    const week = progress ? currentWeekOf(progress.startDay, day) : 1;
    const keep = keptWeeks(latest, progress, week);
    const id = newPlanId();
    const fresh = await writeWeeks(ctx, id, keep + 1, input.actor);
    const plan: GrowthPlan = { ...latest, id, inputsKey: ctx.inputsKey, jobTitle: xray.jobTitle, weeks: mergeRefresh(latest, fresh, keep), refreshedFromWeek: keep + 1 };
    await getStore().set(planKey(xray.id), plan);
    return plan;
  });
  if (!made) return { status: 'generating', xrayId: xray.id };
  const progress = await syncProgress(profile, made, day);
  return planView(made, progress, { pro, today: day, stale: false });
}

/** POST /api/plan/check: checks or unchecks one item; a first check emits `plan_item_done` (points). */
export async function checkPlanItem(input: { profile: Profile; itemId: string; done: boolean; xrayId?: string | null; tz?: string | null }): Promise<PlanCheckResponse> {
  const { profile, itemId, done } = input;
  const candidates = input.xrayId ? [input.xrayId] : [...new Set([profile.lastXrayId, ...Object.keys(profile.planProgress ?? {})].filter((x): x is string => !!x))];
  let plan: GrowthPlan | null = null;
  let week = 0;
  for (const id of candidates) {
    const p = await readPlan(id);
    const hit = p ? itemIndex(p).get(itemId) : undefined;
    if (p && hit && p.profileId === profile.id) {
      plan = p;
      week = hit.week;
      break;
    }
  }
  if (!plan) throw new HttpError(404, 'not_found', 'This plan item no longer exists. Reload the plan.');
  if (!isPro(profile) && week !== 1) throw new HttpError(402, 'pro_required', 'Weeks 2 to 12 are part of Pro.');
  const day = today(profile, input.tz);
  const xrayId = plan.xrayId;
  const planId = plan.id;
  const { profile: next, awards } = await updateProfile(
    profile.id,
    (p) => {
      const prev = p.planProgress?.[xrayId];
      const prog = prev ? { ...prev, done: [...prev.done] } : { planId, startDay: day, done: [] as { id: string; day: string }[] };
      const has = prog.done.some((d) => d.id === itemId);
      if (done && !has) prog.done.push({ id: itemId, day });
      if (!done && has) prog.done = prog.done.filter((d) => d.id !== itemId);
      p.planProgress = { ...(p.planProgress ?? {}), [xrayId]: prog };
      if (done && !has) return emit(p, { type: 'plan_item_done', ref: itemId, data: { xrayId, week } });
    },
    { current: profile },
  );
  return { itemId, done, doneIds: next.planProgress?.[xrayId]?.done.map((d) => d.id) ?? [], pointsAwarded: awards };
}

/** GET /api/plan/progress: a summary for Home and Progress; never writes a plan. */
export async function planSummaryFor(profile: Profile, xrayId?: string | null, tz?: string | null): Promise<PlanSummary> {
  const id = xrayId || profile.lastXrayId || null;
  const pro = isPro(profile);
  if (!id) return planSummary(null, undefined, { pro, today: today(profile, tz), xrayId: null });
  const xray = await readXray(id);
  if (!xray || xray.profileId !== profile.id) throw new HttpError(404, 'not_found', 'Week map not found.');
  const plan = await readPlan(id);
  return planSummary(plan, profile.planProgress?.[id], { pro, today: today(profile, tz), xrayId: id });
}

/**
 * The stored plan for the PDF report (`/x/[id]/report` mounts PlanPrintSection with it), or null when
 * none was written yet. Never calls the model; Free gets week 1 like on screen.
 */
export async function readPlanForReport(profile: Pick<Profile, 'id' | 'tz' | 'plan' | 'planProgress'>, xrayId: string): Promise<PlanResponse | null> {
  const plan = await readPlan(xrayId);
  if (!plan || plan.profileId !== profile.id) return null;
  const day = today(profile);
  const progress = profile.planProgress?.[xrayId] ?? { planId: plan.id, startDay: plan.createdAt.slice(0, 10), done: [] };
  return planView(plan, progress, { pro: isPro(profile), today: day, stale: false });
}
