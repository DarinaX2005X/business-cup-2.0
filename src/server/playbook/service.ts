import { localDay, type RepRecord } from '@/domain/reps';
import type { Locale, PointsAward, Profile } from '@/domain/types';
import { emit } from '@/server/events';
import { isCoach, isPro, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { readRep, weekOf } from '@/server/reps';
import { getTaskTexts } from '@/server/xray';
import { PRACTICE_BAR, practiceByTask } from './personal';
import { ensureStarter, STARTER_CATEGORIES } from './starter';
import type { CheckItem, PlaybookCard, PlaybookProfile, PlaybookView } from './types';

/**
 * Playbook (05.3.1): one card per task of the person's week that AI does or speeds up (plus any week
 * task they practised Delegate on). The instruction on a card is, in order: their own edit, their best
 * practice instruction scored at least PRACTICE_BAR, the starter. The checklist is the starter's checks
 * plus what slipped past them in practice on that task. Without Max the first card is open; the rest are locked
 * and carry no content.
 */

export const COPY_MINUTES = 10;
export const EDIT_MAX_CHARS = 2400;
const EDITS_MAX = 40;
/** Rep records read per request (newest first). */
const REPS_READ = 40;
const WEEK_HOURS = 40;

export interface PlaybookCtx {
  profile: Profile;
  locale: Locale;
  headerTz: string | null;
  ip: string | null;
  now?: Date;
}

const hoursOf = (share: number) => Math.round(((share * WEEK_HOURS) / 100) * 10) / 10;
const copyRef = (day: string, taskId: string) => `${day}:playbook:${taskId}`;
const todayOf = (ctx: PlaybookCtx) => localDay(ctx.now ?? new Date(), ctx.profile.tz ?? ctx.headerTz);

export async function getPlaybook(ctx: PlaybookCtx): Promise<PlaybookView> {
  const { profile, locale } = ctx;
  const week = await weekOf(profile);
  if (!week) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  const { bundle } = week;
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const shares = [...week.shares].filter((s) => byId.has(s.taskId)).sort((a, b) => b.share - a.share);
  const weekIds = new Set(shares.map((s) => s.taskId));

  // Tasks practised as Delegate in this week also get a card, even outside the AI categories.
  const delegated = new Set(profile.repLog.filter((r) => r.type === 'delegate' && r.score !== undefined && weekIds.has(r.taskId)).map((r) => r.taskId));
  const cardShares = shares.filter((s) => STARTER_CATEGORIES.has(byId.get(s.taskId)!.evidence.category) || delegated.has(s.taskId));
  // The playbook comes with Max; everyone else sees the first card. Practising a card is a rep (Pro).
  const pro = isCoach(profile, ctx.now ?? new Date());
  const practise = isPro(profile, ctx.now ?? new Date());

  const empty: PlaybookView = {
    jobTitle: profile.jobTitle ?? bundle.title,
    occupationCode: bundle.code,
    pro,
    practise,
    starter: 'ready',
    practised: false,
    practiceBar: PRACTICE_BAR,
    cards: [],
  };
  if (!cardShares.length) return empty;

  const cardIds = cardShares.map((s) => s.taskId);
  const cardSet = new Set(cardIds);
  const logs = profile.repLog
    .filter((r) => (r.type === 'delegate' || r.type === 'slip') && r.score !== undefined && cardSet.has(r.taskId))
    .slice(-REPS_READ);
  const [texts, starter, records] = await Promise.all([
    getTaskTexts(bundle.code, locale).catch(() => null),
    ensureStarter(bundle, locale, cardIds, { profileId: `${profile.id}:playbook`, ip: ctx.ip }),
    Promise.all(logs.map((l) => readRep(l.id).then((hit) => hit?.rep ?? null).catch(() => null))),
  ]);
  const practice = practiceByTask(records.filter((r): r is RepRecord => !!r), { profileId: profile.id, occupationCode: bundle.code, taskIds: cardIds });
  const edits = (profile as PlaybookProfile).playbook?.edits ?? {};
  const day = todayOf(ctx);
  const copied = new Set(profile.points.events.filter((e) => e.type === 'used_at_work').map((e) => e.ref));

  const cards: PlaybookCard[] = cardShares.map((s, i) => {
    const task = byId.get(s.taskId)!;
    const label = texts?.tasks[s.taskId];
    const base = {
      taskId: s.taskId,
      short: label?.short ?? task.short ?? task.text,
      text: label?.text ?? task.text,
      category: task.evidence.category,
      hours: hoursOf(s.share),
    };
    if (!pro && i > 0) return { ...base, locked: true, instruction: null, practice: null, starter: null, checks: [], copiedToday: false };

    const own = practice.get(s.taskId);
    const start = starter.record?.tasks[s.taskId] ?? null;
    const edit = edits[s.taskId];
    const best = own?.best ?? null;
    let instruction: PlaybookCard['instruction'] = null;
    if (edit?.text) instruction = { text: edit.text, source: 'edited' };
    else if (best && best.score >= PRACTICE_BAR) instruction = { text: best.text, source: 'practice' };
    else if (start) instruction = { text: start.instruction, source: 'starter' };
    else if (best && starter.state === 'unavailable') instruction = { text: best.text, source: 'practice' };

    const checks: CheckItem[] = [
      ...(start?.checks ?? []).map((text, n) => ({ id: `starter:${s.taskId}:${n}`, text, origin: 'starter' as const })),
      ...(own?.checks ?? []),
    ];
    return {
      ...base,
      locked: false,
      instruction,
      practice: best,
      starter: start?.instruction ?? null,
      checks,
      copiedToday: copied.has(copyRef(day, s.taskId)),
    };
  });

  return {
    ...empty,
    starter: starter.state,
    practised: [...practice.values()].some((p) => p.delegated),
    cards,
  };
}

/** The card a mutation may touch: in this person's playbook and not locked for them. */
async function openCard(ctx: PlaybookCtx, taskId: string): Promise<{ view: PlaybookView; card: PlaybookCard }> {
  const view = await getPlaybook(ctx);
  const card = view.cards.find((c) => c.taskId === taskId);
  if (!card) throw new HttpError(404, 'not_found', 'This task is not in your playbook.');
  if (card.locked) throw new HttpError(402, 'max_required', 'The full playbook comes with Max.');
  return { view, card };
}

/** PUT /api/playbook/:taskId { text }: the person's own version replaces what the card shows. */
export async function saveEdit(ctx: PlaybookCtx, taskId: string, text: string): Promise<PlaybookCard> {
  await openCard(ctx, taskId);
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length < 20) throw new HttpError(400, 'too_short', 'Write at least a sentence.');
  if (clean.length > EDIT_MAX_CHARS) throw new HttpError(400, 'too_long', `Up to ${EDIT_MAX_CHARS} characters.`);
  const at = (ctx.now ?? new Date()).toISOString();
  const { profile } = await updateProfile(
    ctx.profile.id,
    (p) => {
      const pp = p as PlaybookProfile;
      const edits = { ...(pp.playbook?.edits ?? {}), [taskId]: { text: clean, at } };
      // keep the newest edits when someone edits a great many tasks over time
      const kept = Object.entries(edits)
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .slice(0, EDITS_MAX);
      pp.playbook = { ...pp.playbook, edits: Object.fromEntries(kept) };
    },
    { current: ctx.profile },
  );
  return (await openCard({ ...ctx, profile }, taskId)).card;
}

/** DELETE /api/playbook/:taskId: drops the edit; the card falls back to practice or the starter. */
export async function clearEdit(ctx: PlaybookCtx, taskId: string): Promise<PlaybookCard> {
  await openCard(ctx, taskId);
  const { profile } = await updateProfile(
    ctx.profile.id,
    (p) => {
      const pp = p as PlaybookProfile;
      if (!pp.playbook?.edits?.[taskId]) return;
      const edits = { ...pp.playbook.edits };
      delete edits[taskId];
      pp.playbook = { ...pp.playbook, edits };
    },
    { current: ctx.profile },
  );
  return (await openCard({ ...ctx, profile }, taskId)).card;
}

/**
 * POST /api/playbook/:taskId/copy: «Copy instruction» counts as using it at work, once a day per task
 * (`used_at_work`, ref `<day>:playbook:<taskId>`, 10 minutes). Points follow the 04.1.1 rules.
 */
export async function recordCopy(ctx: PlaybookCtx, taskId: string): Promise<{ pointsAwarded: PointsAward[]; copiedToday: true }> {
  await openCard(ctx, taskId);
  const day = todayOf(ctx);
  const ref = copyRef(day, taskId);
  if (ctx.profile.points.events.some((e) => e.type === 'used_at_work' && e.ref === ref)) return { pointsAwarded: [], copiedToday: true };
  const { awards } = await updateProfile(
    ctx.profile.id,
    (p) => {
      if (!p.tz && ctx.headerTz) p.tz = ctx.headerTz;
      return emit(p, { type: 'used_at_work', ref, data: { taskId, minutes: COPY_MINUTES, source: 'playbook' }, at: (ctx.now ?? new Date()).toISOString() });
    },
    { current: ctx.profile },
  );
  return { pointsAwarded: awards, copiedToday: true };
}
