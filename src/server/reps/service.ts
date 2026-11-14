import { applyFreeze } from '@/domain/points';
import {
  addDays,
  chooseTask,
  difficultyFor,
  localDay,
  streakAsOf,
  type RepRecord,
  type RepsProfile,
  type RepView,
} from '@/domain/reps';
import type { OccupationBundle, Profile, RepType, WeekShare } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { lock } from '@/server/ai/cache';
import { isAiError } from '@/server/ai/client';
import { isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';
import { loadBundle, readXray } from '@/server/xray';
import type { BankEntry } from './bank';
import { generateDelegate, generateEdge, generateSlip, type GenerateInput } from './generate';
import { clearJob, newRepId, readJob, readRep, repKey, taskCaption, toView, writeJob } from './records';
import { aiOrMeFor } from './ai-or-me';

/**
 * Choosing, reserving and producing reps (03.1.4, round 3). Every rep is written live from the person's
 * own occupation, task and job title; nothing prepared is ever served (the rep bank is only for the
 * landing's static illustrations). A rep is first reserved in the profile (repLog entry + reps id, in one
 * versioned profile update, so two tabs cannot both get today's daily), then produced under
 * `lock('rep:<profile>:<day>:<kind>')`. The model client retries and fails over between models; if the
 * rep still cannot be written, the reservation stays and the rep reads as failed: "Try again" regenerates
 * it under the same id. Slow generation answers `{ status: 'generating', repId }` after 8 s and finishes in
 * after().
 */

export const REP_TYPES: RepType[] = ['slip', 'delegate', 'edge'];
export const MAX_EXTRAS_PER_DAY = 20;
export const GENERATION_WAIT_MS = 8_000;
const LOCK_TTL_SEC = 120;

export interface RepCtx {
  profile: RepsProfile;
  /** IANA zone from the x-tz header (used when the profile has none yet). */
  headerTz: string | null;
  ip?: string | null;
  now?: Date;
  /** Keeps a slow generation running after the response (routes: p => after(() => p)). Without it, calls wait. */
  defer?: (job: Promise<unknown>) => void;
  waitMs?: number;
}

export const nowOf = (ctx: RepCtx) => ctx.now ?? new Date();
/** The profile's zone wins over the header, so changing zones cannot open a second daily rep. */
export const tzOf = (ctx: RepCtx) => ctx.profile.tz ?? ctx.headerTz;
export const todayOf = (ctx: RepCtx) => localDay(nowOf(ctx), tzOf(ctx));
/**
 * Rate limits for reps. Generating a rep counts once against the profile in its own daily bucket
 * (`<profileId>:reps`), so a day of practice never eats the map's quota.
 */
export const actorOf = (ctx: RepCtx): Actor => ({ profileId: `${ctx.profile.id}:reps`, profilePerDay: REP_CALLS_PER_DAY, ip: ctx.ip ?? null });
export const REP_CALLS_PER_DAY = 300;
/**
 * Calls inside a rep (Delegate run, Edge replies, grading) get their own per-profile bucket, so a day of practice
 * never touches the map's limit, while retries and abuse are still capped per profile and not only per IP.
 */
export const REP_INNER_CALLS_PER_DAY = 600;
export const innerActorOf = (ctx: RepCtx): Actor => ({
  profileId: `${ctx.profile.id}:reps-inner`,
  profilePerDay: REP_INNER_CALLS_PER_DAY,
  ip: ctx.ip ?? null,
});

export interface Week {
  bundle: OccupationBundle;
  shares: WeekShare[];
}

/** The person's occupation and week (latest map), or null when they have no map yet. */
export async function weekOf(profile: Profile): Promise<Week | null> {
  if (!profile.occupationCode) return null;
  const bundle = await loadBundle(profile.occupationCode);
  if (!bundle) return null;
  let shares = profile.shares;
  if (!shares?.length && profile.lastXrayId) shares = (await readXray(profile.lastXrayId))?.shares;
  if (!shares?.length) return null;
  return { bundle, shares };
}

async function requireWeek(profile: Profile): Promise<Week> {
  const week = await weekOf(profile);
  if (!week) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  return week;
}

/** O*NET task ids are unique across occupations, so a repLog entry belongs to this occupation iff its task does. */
const ofWeek = (week: Week) => {
  const ids = new Set(week.bundle.tasks.map((t) => t.id));
  return (r: { taskId: string }) => ids.has(r.taskId);
};

/**
 * Today's reps of this kind for the person's current occupation. Reps made for an earlier map (another job)
 * stay in their history but never show up as today's rep for the new one.
 */
const todays = (p: Profile, day: string, kind: RepRecord['kind'], week: Week) => p.repLog.filter((r) => r.day === day && r.kind === kind && ofWeek(week)(r));

export interface Plan {
  id: string;
  profileId: string;
  type: RepType;
  kind: RepRecord['kind'];
  day: string;
  taskId: string;
  seed: string;
  difficulty: 1 | 2 | 3;
  week: Week;
  locale: Profile['locale'];
  jobTitle: string | null;
  actor: Actor;
}

/** Deterministic task for the next rep of this kind and type on `day` (what Today shows is what POST makes). */
export function nextTask(profile: Profile, week: Week, type: RepType, kind: RepRecord['kind'], day: string): { taskId: string; seed: string } {
  const index = kind === 'extra' ? todays(profile, day, 'extra', week).length : 0;
  const seed = `${profile.id}:${day}:${kind}:${index}:${type}`;
  const taskId = chooseTask({ tasks: week.bundle.tasks, shares: week.shares, repLog: profile.repLog, type, day, seed }) ?? week.bundle.tasks[0].id;
  return { taskId, seed };
}

function makePlan(ctx: RepCtx, week: Week, type: RepType, kind: RepRecord['kind'], day: string, reuse?: { id: string; taskId: string }): Plan {
  const { profile } = ctx;
  const next = nextTask(profile, week, type, kind, day);
  // a retry keeps its id and, when it still fits the type and the week, its task; a new seed gives a fresh text
  const keepTask = reuse && ofWeek(week)(reuse) && reuse.taskId;
  return {
    id: reuse?.id ?? newRepId(),
    profileId: profile.id,
    type,
    kind,
    day,
    taskId: keepTask || next.taskId,
    seed: reuse ? `${next.seed}:retry:${Date.now().toString(36)}` : next.seed,
    difficulty: difficultyFor(streakAsOf(applyFreeze(profile.streak, day).streak, day).current),
    week,
    locale: profile.locale,
    jobTitle: profile.jobTitle?.trim() || null,
    actor: actorOf(ctx),
  };
}

// ---------------------------------------------------------------------------------------------
// Producing the rep

function recordFrom(plan: Plan, entry: BankEntry): RepRecord {
  const base: RepRecord = {
    id: plan.id,
    profileId: plan.profileId,
    type: entry.type,
    taskId: entry.taskId,
    occupationCode: entry.occupationCode,
    locale: entry.locale,
    day: plan.day,
    kind: plan.kind,
    status: 'open',
    source: 'live',
    seed: plan.seed,
    difficulty: entry.difficulty,
    title: entry.title,
    brief: entry.brief,
    notes: [],
    createdAt: new Date().toISOString(),
  };
  if (entry.type === 'slip') return { ...base, docType: entry.docType, slip: entry.slip };
  if (entry.type === 'delegate') return { ...base, delegate: { ...entry.delegate } };
  const { opening, ...edge } = entry.edge;
  return { ...base, edge: { ...edge, turns: [{ role: 'persona', text: opening }] } };
}

/** The input every generator gets: only the person's own occupation, task and job title. */
export async function generateInputFor(plan: Plan): Promise<GenerateInput> {
  const { bundle } = plan.week;
  const task = bundle.tasks.find((t) => t.id === plan.taskId);
  if (!task) throw new Error(`task ${plan.taskId} is not a task of ${bundle.code}`);
  const caption = await taskCaption(bundle.code, task.id, 'en');
  return {
    occupationCode: bundle.code,
    occupation: bundle.title,
    jobTitle: plan.jobTitle,
    taskId: task.id,
    task: task.text,
    taskShort: caption.short,
    locale: plan.locale,
    difficulty: plan.difficulty,
    seed: plan.seed,
    actor: plan.actor,
  };
}

/** Writes the rep live. Throws the model client's honest error when it cannot (no prepared fallback). */
export async function produce(plan: Plan): Promise<RepRecord> {
  const input = await generateInputFor(plan);
  const generated = plan.type === 'slip' ? await generateSlip(input) : plan.type === 'delegate' ? await generateDelegate(input) : await generateEdge(input);
  console.info(`[reps] ${plan.type} generated for ${input.occupationCode} in ${generated.attempts} attempt(s), $${generated.costUsd.toFixed(5)}`);
  return recordFrom(plan, generated.entry);
}

async function rollback(plan: Plan): Promise<void> {
  await updateProfile(plan.profileId, (p) => {
    p.repLog = p.repLog.filter((r) => r.id !== plan.id);
    p.reps = p.reps.filter((r) => r !== plan.id);
    if (plan.kind === 'trial' && p.trial.repId === plan.id) p.trial = { status: 'available' };
  });
}

export type CreateResult = { rep: RepView } | { status: 'generating'; repId: string };

const failedError = (repId: string, reason?: string) =>
  new HttpError(503, 'generation_failed', "We couldn't write this one. Try again.", { repId, retryable: true, ...(reason ? { reason } : {}) });

/**
 * Produces the reserved rep under the lock; waits up to 8 s, then hands the job to `defer`. On failure the
 * reservation stays (the rep reads as failed and "Try again" reuses its id). `fresh` reservations are rolled
 * back only when the lock is taken by another request.
 */
async function startGeneration(ctx: RepCtx, plan: Plan, fresh: boolean): Promise<CreateResult> {
  const held = await lock(`rep:${plan.profileId}:${plan.day}:${plan.kind}`, LOCK_TTL_SEC);
  if (!held) {
    if (fresh) await rollback(plan).catch(() => undefined);
    throw new HttpError(409, 'in_progress', 'Another rep of this kind is being prepared; try again in a moment.');
  }
  await writeJob(plan.id, { status: 'generating', profileId: plan.profileId, at: new Date().toISOString() });
  const job = (async () => {
    try {
      const record = await produce(plan);
      const store = getStore();
      await store.del(repKey(record.id)); // a retry for a changed occupation replaces the old text
      await store.set(repKey(record.id), record, { version: 0 });
      await updateProfile(plan.profileId, (p) => {
        const entry = p.repLog.find((r) => r.id === record.id);
        if (entry && (entry.taskId !== record.taskId || entry.type !== record.type)) Object.assign(entry, { taskId: record.taskId, type: record.type });
        if (!p.reps.includes(record.id)) p.reps.push(record.id);
      });
      await clearJob(plan.id);
      return record;
    } catch (err) {
      const reason = isAiError(err) ? err.code : 'error';
      console.error(`[reps] rep ${plan.id} (${plan.type}/${plan.kind}) could not be written: ${isAiError(err) ? err.code : (err as Error).message}`);
      await writeJob(plan.id, { status: 'failed', profileId: plan.profileId, at: new Date().toISOString(), reason }).catch(() => undefined);
      throw failedError(plan.id, reason);
    } finally {
      await held.release().catch(() => undefined);
    }
  })();

  if (!ctx.defer) return { rep: await toView(await job, ctx.profile.locale) };
  const outcome = await Promise.race([
    job.then(
      (record) => ({ record }),
      (error: unknown) => ({ error }),
    ),
    new Promise<null>((r) => setTimeout(() => r(null), ctx.waitMs ?? GENERATION_WAIT_MS)),
  ]);
  if (outcome === null) {
    ctx.defer(job.catch(() => undefined));
    return { status: 'generating', repId: plan.id };
  }
  if ('error' in outcome) throw outcome.error;
  return { rep: await toView(outcome.record, ctx.profile.locale) };
}

// ---------------------------------------------------------------------------------------------
// Reading

export type RepState = { rep: RepView } | { status: 'generating'; repId: string } | { status: 'failed'; repId: string } | null;

/**
 * The state of one of the person's reps. A reserved rep with no text and no running job (it failed, or
 * the job marker expired) reads as failed, so it can be retried under the same id.
 */
export async function repState(id: string, profile: Profile): Promise<RepState> {
  if (!profile.reps.includes(id)) return null;
  const hit = await readRep(id);
  if (hit && hit.rep.profileId === profile.id) return { rep: await toView(hit.rep, profile.locale) };
  const job = await readJob(id);
  if (job?.profileId === profile.id && job.status === 'generating') return { status: 'generating', repId: id };
  return { status: 'failed', repId: id };
}

/** GET /api/reps/:id */
export async function getRep(ctx: RepCtx, id: string): Promise<{ rep: RepView } | { status: 'generating'; repId: string }> {
  const state = await repState(id, ctx.profile);
  if (!state) throw new HttpError(404, 'not_found', 'Rep not found.');
  if ('status' in state && state.status === 'failed') throw failedError(id, (await readJob(id))?.reason);
  return state as { rep: RepView } | { status: 'generating'; repId: string };
}

// ---------------------------------------------------------------------------------------------
// Create (daily / extra) and retry

class Taken extends Error {
  constructor(readonly repId: string) {
    super('taken');
  }
}

/** Regenerates a failed rep under the same id (type may change to what the person asked for now). */
async function retryEntry(ctx: RepCtx, week: Week, entry: Profile['repLog'][number], type: RepType): Promise<CreateResult> {
  const plan = makePlan(ctx, week, type, entry.kind, entry.day, { id: entry.id, taskId: type === entry.type ? entry.taskId : '' });
  if (plan.type !== entry.type || plan.taskId !== entry.taskId) {
    await updateProfile(ctx.profile.id, (p) => {
      const e = p.repLog.find((r) => r.id === entry.id);
      if (e) Object.assign(e, { type: plan.type, taskId: plan.taskId });
    });
  }
  return startGeneration(ctx, plan, false);
}

export async function createRep(ctx: RepCtx, input: { type: RepType; kind: 'daily' | 'extra' }): Promise<CreateResult> {
  const { profile } = ctx;
  if (!isPro(profile, nowOf(ctx))) throw new HttpError(402, 'pro_required', 'Daily reps are part of Pro.');
  const week = await requireWeek(profile);
  const day = todayOf(ctx);

  // "Try again" after a failure reuses the failed rep's id: today's daily, or a failed extra of today
  const candidates = input.kind === 'daily' ? todays(profile, day, 'daily', week).slice(0, 1) : todays(profile, day, 'extra', week);
  for (const entry of candidates) {
    const state = await repState(entry.id, profile);
    if (state && 'status' in state && state.status === 'failed') return retryEntry(ctx, week, entry, input.type);
  }

  const plan = makePlan(ctx, week, input.type, input.kind, day);
  try {
    await updateProfile(
      profile.id,
      (p) => {
        if (input.kind === 'daily') {
          const existing = todays(p, day, 'daily', week)[0];
          if (existing) throw new Taken(existing.id);
        } else if (todays(p, day, 'extra', week).length >= MAX_EXTRAS_PER_DAY) {
          throw new HttpError(429, 'extra_limit', `Up to ${MAX_EXTRAS_PER_DAY} extra reps a day.`);
        }
        if (!p.tz && ctx.headerTz) p.tz = ctx.headerTz;
        p.reps.push(plan.id);
        p.repLog.push({ id: plan.id, taskId: plan.taskId, type: plan.type, kind: plan.kind, day });
      },
      { current: profile },
    );
  } catch (err) {
    if (err instanceof Taken) {
      const state = await repState(err.repId, profile);
      throw new HttpError(409, 'daily_exists', "Today's rep already exists.", { ...(state ?? {}), repId: err.repId });
    }
    throw err;
  }
  return startGeneration(ctx, plan, true);
}

/** POST /api/reps/:id/retry: writes a failed rep again under the same id. */
export async function retryRep(ctx: RepCtx, id: string): Promise<CreateResult> {
  const { profile } = ctx;
  const entry = profile.repLog.find((r) => r.id === id);
  if (!entry || !profile.reps.includes(id)) throw new HttpError(404, 'not_found', 'Rep not found.');
  const state = await repState(id, profile);
  if (state && !('status' in state && state.status === 'failed')) return state as CreateResult;
  const week = await requireWeek(profile);
  if (entry.kind !== 'trial' && !isPro(profile, nowOf(ctx))) throw new HttpError(402, 'pro_required', 'Daily reps are part of Pro.');
  return retryEntry(ctx, week, entry, entry.type);
}

// ---------------------------------------------------------------------------------------------
// Trial

export async function startTrial(ctx: RepCtx): Promise<CreateResult> {
  const { profile } = ctx;
  const week = await requireWeek(profile);
  const day = todayOf(ctx);
  if (profile.trial.status === 'used') throw new HttpError(409, 'trial_used', 'The free rep has been used.', { repId: profile.trial.repId });
  const current = profile.trial.status === 'in_progress' && profile.trial.repId ? profile.repLog.find((r) => r.id === profile.trial.repId) : undefined;
  if (current) {
    const state = await repState(current.id, profile);
    // the open trial was written for this occupation: keep it; for another job or failed: rewrite, same id
    if (state && 'rep' in state && state.rep.occupationCode === week.bundle.code) return state;
    if (state && 'status' in state && state.status === 'generating') return state;
    const plan = makePlan(ctx, week, 'slip', 'trial', day, ofWeek(week)(current) ? current : { id: current.id, taskId: '' });
    await updateProfile(profile.id, (p) => {
      const e = p.repLog.find((r) => r.id === current.id);
      if (e) Object.assign(e, { taskId: plan.taskId, day });
    });
    return startGeneration(ctx, plan, false);
  }
  const plan = makePlan(ctx, week, 'slip', 'trial', day);
  await updateProfile(
    profile.id,
    (p) => {
      if (p.trial.status === 'used') throw new HttpError(409, 'trial_used', 'The free rep has been used.', { repId: p.trial.repId });
      if (!p.tz && ctx.headerTz) p.tz = ctx.headerTz;
      p.trial = { status: 'in_progress', repId: plan.id };
      p.reps.push(plan.id);
      p.repLog.push({ id: plan.id, taskId: plan.taskId, type: 'slip', kind: 'trial', day });
    },
    { current: profile },
  );
  return startGeneration(ctx, plan, true);
}

// ---------------------------------------------------------------------------------------------
// Today

export interface ChoiceTask {
  type: RepType;
  taskId: string;
  taskText: string;
  taskShort: string;
  /** Rough minutes, for the choice card. */
  minutes: number;
}

const MINUTES: Record<RepType, number> = { slip: 5, delegate: 10, edge: 8 };

async function choiceFor(profile: Profile, week: Week, type: RepType, kind: RepRecord['kind'], day: string): Promise<ChoiceTask> {
  const { taskId } = nextTask(profile, week, type, kind, day);
  const caption = await taskCaption(week.bundle.code, taskId, profile.locale);
  return { type, taskId, taskText: caption.text, taskShort: caption.short, minutes: MINUTES[type] };
}

/** What tomorrow's daily rep will be (type rotates by date; task chosen as POST would), without generating. */
export async function tomorrowFor(profile: Profile, week: Week, today: string): Promise<ChoiceTask> {
  const day = addDays(today, 1);
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const type = REP_TYPES[n % REP_TYPES.length];
  return choiceFor(profile, week, type, 'daily', day);
}

export async function trialState(
  profile: Profile,
  week: Week | null,
): Promise<{ status: Profile['trial']['status']; repId?: string; rep?: RepView; generating?: boolean; failed?: boolean }> {
  const { status, repId } = profile.trial;
  if (!repId) return { status };
  const state = await repState(repId, profile);
  if (state && 'rep' in state) {
    // an open trial written for another job is not shown: starting the trial again rewrites it for this one
    if (status === 'in_progress' && week && state.rep.occupationCode !== week.bundle.code) return { status: 'available', repId };
    return { status, repId, rep: state.rep };
  }
  if (state?.status === 'generating') return { status, repId, generating: true };
  if (state?.status === 'failed') return { status, repId, failed: true };
  return { status: status === 'in_progress' ? 'available' : status, repId };
}

export async function getToday(ctx: RepCtx) {
  const { profile } = ctx;
  const day = todayOf(ctx);
  const week = await weekOf(profile);
  // reading applies a freeze to missed days without spending it (spent only when a rep is saved)
  const streak = streakAsOf(applyFreeze(profile.streak, day).streak, day);
  const aiOrMe = week ? await aiOrMeFor(profile, week, day) : null;
  const tomorrow = week ? await tomorrowFor(profile, week, day) : null;
  if (!isPro(profile, nowOf(ctx))) {
    throw new HttpError(402, 'pro_required', 'Daily reps are part of Pro.', { trial: await trialState(profile, week), aiOrMe, hasXray: !!week, tomorrow, streak });
  }
  if (!week) throw new HttpError(409, 'no_xray', 'Make your week map first.', { hasXray: false });

  let pending: { repId: string; kind: RepRecord['kind'] } | null = null;
  const failed: { repId: string; kind: RepRecord['kind']; type: RepType }[] = [];
  const dailyEntry = todays(profile, day, 'daily', week)[0];
  let daily: RepView | null = null;
  if (dailyEntry) {
    const state = await repState(dailyEntry.id, profile);
    if (state && 'rep' in state) daily = state.rep;
    else if (state?.status === 'generating') pending = { repId: dailyEntry.id, kind: 'daily' };
    else if (state?.status === 'failed') failed.push({ repId: dailyEntry.id, kind: 'daily', type: dailyEntry.type });
  }
  const extras: RepView[] = [];
  for (const e of todays(profile, day, 'extra', week)) {
    const state = await repState(e.id, profile);
    if (state && 'rep' in state) extras.push(state.rep);
    else if (state?.status === 'generating' && !pending) pending = { repId: e.id, kind: 'extra' };
    else if (state?.status === 'failed') failed.push({ repId: e.id, kind: 'extra', type: e.type });
  }
  // a failed daily is retried through the daily choice (same id), so the hub still offers the daily choice
  const nextKind: RepRecord['kind'] = dailyEntry && !failed.some((f) => f.repId === dailyEntry.id) ? 'extra' : 'daily';
  const choiceTasks = Object.fromEntries(await Promise.all(REP_TYPES.map(async (t) => [t, await choiceFor(profile, week, t, nextKind, day)] as const))) as Record<
    RepType,
    ChoiceTask
  >;
  return {
    ...(pending ? { status: 'generating' as const, repId: pending.repId, pendingKind: pending.kind } : {}),
    day,
    daily,
    extras,
    failed,
    extrasLeft: Math.max(0, MAX_EXTRAS_PER_DAY - todays(profile, day, 'extra', week).length),
    choices: REP_TYPES,
    nextKind,
    choiceTasks,
    streak,
    aiOrMe,
    tomorrow,
  };
}
