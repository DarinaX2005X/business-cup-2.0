import {
  addDays,
  chooseTask,
  difficultyFor,
  localDay,
  streakAsOf,
  type RepNote,
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
import { findBankSame, findBankSlip, type BankEntry, type BankItem } from './bank';
import { generateDelegate, generateEdge, generateSlip, type GenerateInput } from './generate';
import { clearJob, newRepId, readJob, readRep, repKey, taskCaption, toView, writeJob } from './records';
import { aiOrMeFor } from './ai-or-me';

/**
 * Choosing, reserving and producing reps (03.1.4). A rep is first reserved in the profile (repLog entry
 * + reps id, checked and written in one versioned profile update, so two tabs cannot both get today's
 * daily), then produced under `lock('rep:<profile>:<day>:<kind>')`: live generation, or the bank when the
 * model is out of budget, failing or its output does not pass the checks. Slow generation answers
 * `{ status: 'generating', repId }` after 8 s and finishes in after().
 */

export const REP_TYPES: RepType[] = ['slip', 'delegate', 'edge'];
export const MAX_EXTRAS_PER_DAY = 3;
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
 * (`<profileId>:reps`, 25/day like the shared one, so a day of practice never eats the map's quota);
 * the calls inside a rep (Delegate run, Edge replies, grading) count only against the IP, because the
 * engine already bounds them: at most 1 daily + 3 extras + 1 trial a day, 6 Edge replies, 1 Delegate run.
 */
export const actorOf = (ctx: RepCtx): Actor => ({ profileId: `${ctx.profile.id}:reps`, ip: ctx.ip ?? null });
/**
 * Calls inside a rep (Delegate run, Edge replies, grading) get their own per-profile bucket, so a day of practice
 * (1 daily + 3 extras + trial, up to 7 calls each) never touches the map's limit, while retries and abuse are still
 * capped per profile and not only per IP.
 */
export const REP_INNER_CALLS_PER_DAY = 60;
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

const todays = (p: Profile, day: string, kind: RepRecord['kind']) => p.repLog.filter((r) => r.day === day && r.kind === kind);

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
  avoidTaskIds: string[];
  actor: Actor;
  /** Trial: a bank rep in the user's language first, live only without one. */
  bankFirst: boolean;
}

/** Deterministic task for the next rep of this kind and type on `day` (what Today shows is what POST makes). */
export function nextTask(profile: Profile, week: Week, type: RepType, kind: RepRecord['kind'], day: string): { taskId: string; seed: string } {
  const index = kind === 'extra' ? todays(profile, day, 'extra').length : 0;
  const seed = `${profile.id}:${day}:${kind}:${index}:${type}`;
  const taskId = chooseTask({ tasks: week.bundle.tasks, shares: week.shares, repLog: profile.repLog, type, day, seed }) ?? week.bundle.tasks[0].id;
  return { taskId, seed };
}

function makePlan(ctx: RepCtx, week: Week, type: RepType, kind: RepRecord['kind'], day: string): Plan {
  const { profile } = ctx;
  const { taskId, seed } = nextTask(profile, week, type, kind, day);
  const recent = profile.repLog.filter((r) => r.day >= addDays(day, -4)).map((r) => r.taskId);
  return {
    id: newRepId(),
    profileId: profile.id,
    type,
    kind,
    day,
    taskId,
    seed,
    difficulty: difficultyFor(streakAsOf(profile.streak, day).current),
    week,
    locale: profile.locale,
    avoidTaskIds: recent,
    actor: actorOf(ctx),
    bankFirst: kind === 'trial',
  };
}

// ---------------------------------------------------------------------------------------------
// Producing the rep

function recordFrom(plan: Plan, entry: BankEntry, source: RepRecord['source'], seed: string, notes: RepNote[]): RepRecord {
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
    source,
    seed,
    difficulty: entry.difficulty,
    title: entry.title,
    brief: entry.brief,
    notes: [...new Set(notes)],
    createdAt: new Date().toISOString(),
  };
  if (entry.type === 'slip') return { ...base, docType: entry.docType, slip: entry.slip };
  if (entry.type === 'delegate') return { ...base, delegate: { ...entry.delegate } };
  const { opening, ...edge } = entry.edge;
  return { ...base, edge: { ...edge, turns: [{ role: 'persona', text: opening }] } };
}

const fromBank = (plan: Plan, pick: { item: BankItem; notes: RepNote[] }, extra: RepNote[] = []) =>
  recordFrom(plan, pick.item, 'bank', `bank:${pick.item.file}`, [...extra, ...pick.notes]);

/**
 * Live generation with every fallback: same-type bank rep of this occupation (delegate/edge), then a
 * bank slip (same occupation → same group → any), the type swap noted. Throws only when nothing is left.
 */
export async function produce(plan: Plan): Promise<RepRecord> {
  const { bundle } = plan.week;
  const query = { code: bundle.code, locale: plan.locale, weekTaskIds: plan.week.shares.map((s) => s.taskId), avoidTaskIds: plan.avoidTaskIds, seed: plan.seed };
  if (plan.bankFirst) {
    const own = await findBankSame(plan.type, { ...query }, { english: false });
    if (own) return fromBank(plan, own);
  }
  const task = bundle.tasks.find((t) => t.id === plan.taskId) ?? bundle.tasks[0];
  const caption = await taskCaption(bundle.code, task.id, 'en');
  const input: GenerateInput = {
    occupationCode: bundle.code,
    occupation: bundle.title,
    taskId: task.id,
    task: task.text,
    taskShort: caption.short,
    locale: plan.locale,
    difficulty: plan.difficulty,
    seed: plan.seed,
    actor: plan.actor,
  };
  try {
    const generated = plan.type === 'slip' ? await generateSlip(input) : plan.type === 'delegate' ? await generateDelegate(input) : await generateEdge(input);
    console.info(`[reps] ${plan.type} generated for ${bundle.code} in ${generated.attempts} attempt(s), $${generated.costUsd.toFixed(5)}`);
    return recordFrom(plan, generated.entry, 'live', plan.seed, []);
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.info(`[reps] ${plan.type} live generation unavailable (${err.code}); using the bank`);
    if (plan.type !== 'slip') {
      const same = await findBankSame(plan.type, query);
      if (same) return fromBank(plan, same);
    }
    const slip = await findBankSlip(query);
    if (slip) return fromBank(plan, slip, plan.type !== 'slip' ? ['type_swapped'] : []);
    throw err;
  }
}

async function rollback(plan: Plan): Promise<void> {
  await updateProfile(plan.profileId, (p) => {
    p.repLog = p.repLog.filter((r) => r.id !== plan.id);
    p.reps = p.reps.filter((r) => r !== plan.id);
    if (plan.kind === 'trial' && p.trial.repId === plan.id) p.trial = { status: 'available' };
  });
}

export type CreateResult = { rep: RepView } | { status: 'generating'; repId: string };

/** Produces the reserved rep under the lock; waits up to 8 s, then hands the job to `defer`. */
async function startGeneration(ctx: RepCtx, plan: Plan): Promise<CreateResult> {
  const held = await lock(`rep:${plan.profileId}:${plan.day}:${plan.kind}`, LOCK_TTL_SEC);
  if (!held) {
    await rollback(plan).catch(() => undefined);
    throw new HttpError(409, 'in_progress', 'Another rep of this kind is being prepared; try again in a moment.');
  }
  await writeJob(plan.id, { status: 'generating', profileId: plan.profileId, at: new Date().toISOString() });
  const job = (async () => {
    try {
      const record = await produce(plan);
      await getStore().set(repKey(record.id), record, { version: 0 });
      if (record.taskId !== plan.taskId || record.type !== plan.type) {
        await updateProfile(plan.profileId, (p) => {
          const entry = p.repLog.find((r) => r.id === record.id);
          if (entry) Object.assign(entry, { taskId: record.taskId, type: record.type });
        });
      }
      await clearJob(plan.id);
      return record;
    } catch (err) {
      console.error(`[reps] rep ${plan.id} (${plan.type}/${plan.kind}) could not be produced: ${isAiError(err) ? err.code : (err as Error).message}`);
      await rollback(plan).catch(() => undefined);
      await writeJob(plan.id, { status: 'failed', profileId: plan.profileId, at: new Date().toISOString(), reason: isAiError(err) ? err.code : 'error' }).catch(() => undefined);
      throw err;
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

export async function repState(id: string, profile: Profile): Promise<RepState> {
  if (!profile.reps.includes(id)) {
    const job = await readJob(id);
    return job?.profileId === profile.id && job.status === 'failed' ? { status: 'failed', repId: id } : null;
  }
  const hit = await readRep(id);
  if (hit && hit.rep.profileId === profile.id) return { rep: await toView(hit.rep, profile.locale) };
  const job = await readJob(id);
  if (job?.profileId === profile.id) return { status: job.status, repId: id };
  return null;
}

/** GET /api/reps/:id */
export async function getRep(ctx: RepCtx, id: string): Promise<{ rep: RepView } | { status: 'generating'; repId: string }> {
  const state = await repState(id, ctx.profile);
  if (!state) throw new HttpError(404, 'not_found', 'Rep not found.');
  if ('status' in state && state.status === 'failed') {
    throw new HttpError(503, 'generation_failed', 'The rep could not be prepared. Start it again.');
  }
  return state as { rep: RepView } | { status: 'generating'; repId: string };
}

// ---------------------------------------------------------------------------------------------
// Create (daily / extra)

class Taken extends Error {
  constructor(readonly repId: string) {
    super('taken');
  }
}

export async function createRep(ctx: RepCtx, input: { type: RepType; kind: 'daily' | 'extra' }): Promise<CreateResult> {
  const { profile } = ctx;
  if (!isPro(profile, nowOf(ctx))) throw new HttpError(402, 'pro_required', 'Daily reps are part of Pro.');
  const week = await requireWeek(profile);
  const day = todayOf(ctx);
  const plan = makePlan(ctx, week, input.type, input.kind, day);
  try {
    await updateProfile(
      profile.id,
      (p) => {
        if (input.kind === 'daily') {
          const existing = todays(p, day, 'daily')[0];
          if (existing) throw new Taken(existing.id);
        } else if (todays(p, day, 'extra').length >= MAX_EXTRAS_PER_DAY) {
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
  return startGeneration(ctx, plan);
}

// ---------------------------------------------------------------------------------------------
// Trial

export async function startTrial(ctx: RepCtx): Promise<CreateResult> {
  const { profile } = ctx;
  const week = await requireWeek(profile);
  const day = todayOf(ctx);
  if (profile.trial.status === 'used') throw new HttpError(409, 'trial_used', 'The free rep has been used.', { repId: profile.trial.repId });
  if (profile.trial.status === 'in_progress' && profile.trial.repId) {
    const state = await repState(profile.trial.repId, profile);
    if (state && !('status' in state && state.status === 'failed')) return state as CreateResult;
  }
  const plan = makePlan(ctx, week, 'slip', 'trial', day);
  let existing: string | null = null;
  await updateProfile(
    profile.id,
    (p) => {
      if (p.trial.status === 'used') throw new HttpError(409, 'trial_used', 'The free rep has been used.', { repId: p.trial.repId });
      if (p.trial.status === 'in_progress' && p.trial.repId && p.reps.includes(p.trial.repId)) {
        existing = p.trial.repId;
        return;
      }
      if (!p.tz && ctx.headerTz) p.tz = ctx.headerTz;
      p.trial = { status: 'in_progress', repId: plan.id };
      p.reps.push(plan.id);
      p.repLog.push({ id: plan.id, taskId: plan.taskId, type: 'slip', kind: 'trial', day });
    },
    { current: profile },
  );
  if (existing) {
    const state = await repState(existing, profile);
    if (state && !('status' in state && state.status === 'failed')) return state as CreateResult;
    throw new HttpError(409, 'in_progress', 'The free rep is being prepared.', { repId: existing });
  }
  return startGeneration(ctx, plan);
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

export async function trialState(profile: Profile): Promise<{ status: Profile['trial']['status']; repId?: string; rep?: RepView; generating?: boolean }> {
  const { status, repId } = profile.trial;
  if (!repId) return { status };
  const state = await repState(repId, profile);
  if (state && 'rep' in state) return { status, repId, rep: state.rep };
  if (state && state.status === 'generating') return { status, repId, generating: true };
  return { status: status === 'in_progress' ? 'available' : status, repId };
}

export async function getToday(ctx: RepCtx) {
  const { profile } = ctx;
  const day = todayOf(ctx);
  const week = await weekOf(profile);
  const streak = streakAsOf(profile.streak, day);
  const aiOrMe = week ? await aiOrMeFor(profile, week, day) : null;
  const tomorrow = week ? await tomorrowFor(profile, week, day) : null;
  if (!isPro(profile, nowOf(ctx))) {
    throw new HttpError(402, 'pro_required', 'Daily reps are part of Pro.', { trial: await trialState(profile), aiOrMe, hasXray: !!week, tomorrow, streak });
  }
  if (!week) throw new HttpError(409, 'no_xray', 'Make your week map first.', { hasXray: false });

  let pending: { repId: string; kind: RepRecord['kind'] } | null = null;
  const dailyEntry = todays(profile, day, 'daily')[0];
  let daily: RepView | null = null;
  if (dailyEntry) {
    const state = await repState(dailyEntry.id, profile);
    if (state && 'rep' in state) daily = state.rep;
    else if (state?.status === 'generating') pending = { repId: dailyEntry.id, kind: 'daily' };
  }
  const extras: RepView[] = [];
  for (const e of todays(profile, day, 'extra')) {
    const state = await repState(e.id, profile);
    if (state && 'rep' in state) extras.push(state.rep);
    else if (state?.status === 'generating' && !pending) pending = { repId: e.id, kind: 'extra' };
  }
  const nextKind: RepRecord['kind'] = dailyEntry ? 'extra' : 'daily';
  const choiceTasks = Object.fromEntries(await Promise.all(REP_TYPES.map(async (t) => [t, await choiceFor(profile, week, t, nextKind, day)] as const))) as Record<
    RepType,
    ChoiceTask
  >;
  return {
    ...(pending ? { status: 'generating' as const, repId: pending.repId, pendingKind: pending.kind } : {}),
    day,
    daily,
    extras,
    extrasLeft: Math.max(0, MAX_EXTRAS_PER_DAY - todays(profile, day, 'extra').length),
    choices: REP_TYPES,
    nextKind,
    choiceTasks,
    streak,
    aiOrMe,
    tomorrow,
  };
}
