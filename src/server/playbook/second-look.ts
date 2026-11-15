import { localDay, locateLoose, normalizeDocument, normalizeQuote, occurrences, toLightMarkup, wordCount } from '@/domain/reps';
import type { Locale, PointsAward, Profile } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { callModel } from '@/server/ai/client';
import { secondLookPrompt, secondLookSchema, type SecondLookAnswer } from '@/server/ai/prompts/second-look';
import { emit } from '@/server/events';
import { isCoach, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { weekOf } from '@/server/reps';
import { getTaskTexts } from '@/server/xray';
import type { PlaybookProfile, SecondLookMark, SecondLookResult, SecondLookState, SecondLookTask } from './types';

/**
 * Second look (05.3.2): a real AI draft from the person's work, read once by `second.look`, comes back
 * with up to six «Check this» places. The text is never stored, cached or logged: only a counter of
 * runs is kept on the profile (Free gets one). Each run is `used_at_work` for the day.
 */

export const SECOND_LOOK_FREE = 1;
export const SECOND_LOOK_MAX_CHARS = 4000;
export const SECOND_LOOK_MIN_WORDS = 12;
const MAX_MARKS = 6;
const TASKS_SHOWN = 8;
/** A Max profile's own bucket of model calls for Second look (the money is capped globally anyway). */
const CALLS_PER_DAY = 60;

const WEEK_HOURS = 40;
const hoursOf = (share: number) => Math.round(((share * WEEK_HOURS) / 100) * 10) / 10;

/** Free runs left for this profile (null for Max, where Second look has no limit). */
export function freeLeft(profile: Profile | null, now = new Date()): number | null {
  if (profile && isCoach(profile, now)) return null;
  const used = (profile as PlaybookProfile | null)?.playbook?.secondLook?.used ?? 0;
  return Math.max(0, SECOND_LOOK_FREE - used);
}

/** GET /api/second-look: plan, free runs left and the week's tasks for the picker (biggest first). */
export async function secondLookState(profile: Profile | null, locale: Locale): Promise<SecondLookState> {
  const base: SecondLookState = { pro: !!profile && isCoach(profile), freeLeft: freeLeft(profile), jobTitle: profile?.jobTitle ?? null, tasks: [] };
  if (!profile) return base;
  const week = await weekOf(profile);
  if (!week) return base;
  const texts = await getTaskTexts(week.bundle.code, locale).catch(() => null);
  const known = new Set(week.bundle.tasks.map((t) => t.id));
  const tasks: SecondLookTask[] = [...week.shares]
    .filter((s) => known.has(s.taskId))
    .sort((a, b) => b.share - a.share)
    .slice(0, TASKS_SHOWN)
    .map((s) => ({ taskId: s.taskId, short: texts?.tasks[s.taskId]?.short ?? s.taskId, hours: hoursOf(s.share) }));
  return { ...base, jobTitle: profile.jobTitle ?? week.bundle.title, tasks };
}

/** The pasted text in the form it is checked and shown in: light markup, normalised spaces and quotes. */
export function prepareText(raw: string): string {
  // a pasted top-level heading becomes a section heading: the sheet's own title line sits above it
  return normalizeDocument(toLightMarkup(raw)).replace(/^( {0,2})# /gm, '$1## ');
}

const clean = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? '' : t;
};

/**
 * Pure: keeps marks whose quote really is in the document (exactly, or ignoring case, punctuation and
 * spacing), at most six, without overlaps and without a «mark» over a large part of the text.
 * Positions point into `document`; marks come back in reading order.
 */
export function verifyMarks(document: string, raw: SecondLookAnswer['marks'], max = MAX_MARKS): SecondLookMark[] {
  const taken: [number, number][] = [];
  const out: Omit<SecondLookMark, 'id'>[] = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  for (const m of raw) {
    if (out.length >= max) break;
    const quote = normalizeQuote(m.quote ?? '');
    if (wordCount(quote) < 2 && quote.length < 6) continue;
    let range: [number, number] | null = null;
    for (const at of occurrences(document, quote)) {
      if (!overlaps(at, at + quote.length)) {
        range = [at, at + quote.length];
        break;
      }
    }
    if (!range) {
      const loose = locateLoose(document, quote);
      if (loose && !overlaps(loose[0], loose[1])) range = loose;
    }
    if (!range) continue;
    // a quote copied with its list dash, heading mark or table bar starts at the visible words
    while (range[0] < range[1] && /[\s\-*#|>]/.test(document[range[0]])) range[0]++;
    while (range[1] > range[0] && /\s/.test(document[range[1] - 1])) range[1]--;
    if (range[1] - range[0] < 4) continue;
    const len = range[1] - range[0];
    if (len > 400 || len > document.length * 0.5) continue;
    const why = clean(m.why ?? '', 260);
    const check = clean(m.check ?? '', 260);
    if (!why || !check) continue;
    taken.push(range);
    out.push({ start: range[0], end: range[1], type: m.type, why, check });
  }
  return out.sort((a, b) => a.start - b.start).map((m, i) => ({ id: `c${i + 1}`, ...m }));
}

export interface SecondLookInput {
  text: string;
  taskId: string | null;
  locale: Locale;
}

export interface SecondLookCtx {
  profile: Profile;
  headerTz: string | null;
  ip: string | null;
  now?: Date;
}

/** POST /api/second-look. Free: one run in total; a failed run gives its turn back. */
export async function runSecondLook(ctx: SecondLookCtx, input: SecondLookInput): Promise<SecondLookResult & { pointsAwarded: PointsAward[] }> {
  const { profile } = ctx;
  const now = ctx.now ?? new Date();
  const document = prepareText(input.text);
  if (wordCount(document) < SECOND_LOOK_MIN_WORDS) throw new HttpError(400, 'text_too_short', 'Paste at least a few sentences.');
  if (document.length > SECOND_LOOK_MAX_CHARS) throw new HttpError(400, 'text_too_long', `Up to ${SECOND_LOOK_MAX_CHARS} characters.`);

  const week = await weekOf(profile).catch(() => null);
  const occupation = week?.bundle.title ?? profile.jobTitle ?? null;
  let task: string | null = null;
  if (input.taskId && week) {
    const t = week.bundle.tasks.find((x) => x.id === input.taskId);
    if (!t) throw new HttpError(400, 'invalid_input', 'taskId: not a task of your week');
    task = t.text;
  }

  // Take the turn first (so two tabs cannot both use the free one), give it back if the read fails.
  const pro = isCoach(profile, now);
  const taken = await updateProfile(
    profile.id,
    (p) => {
      const pp = p as PlaybookProfile;
      const used = pp.playbook?.secondLook?.used ?? 0;
      if (!pro && used >= SECOND_LOOK_FREE) throw new HttpError(402, 'max_required', 'Second look comes with Max after the free one.');
      pp.playbook = { ...pp.playbook, secondLook: { used: used + 1, lastAt: now.toISOString() } };
    },
    { current: profile },
  );

  let answer: SecondLookAnswer;
  try {
    const actor: Actor = { profileId: `${profile.id}:second-look`, profilePerDay: CALLS_PER_DAY, ip: ctx.ip };
    const res = await callModel({
      op: 'second.look',
      schema: secondLookSchema,
      system: secondLookPrompt.system({ occupation, locale: input.locale }),
      user: secondLookPrompt.user({ occupation, task, text: document }),
      locale: input.locale,
      maxTokens: 2400,
      temperature: 0.2,
      reasoning: 'low',
      actor,
      // no cacheKey: the text must not be kept anywhere
    });
    answer = res.data;
  } catch (err) {
    await updateProfile(profile.id, (p) => {
      const pp = p as PlaybookProfile;
      const used = pp.playbook?.secondLook?.used ?? 0;
      pp.playbook = { ...pp.playbook, secondLook: { used: Math.max(0, used - 1), lastAt: pp.playbook?.secondLook?.lastAt ?? null } };
    }).catch(() => undefined);
    throw err;
  }

  const marks = verifyMarks(document, answer.marks);
  const day = localDay(now, profile.tz ?? ctx.headerTz);
  const { profile: after, awards } = await updateProfile(
    profile.id,
    (p) => emit(p, { type: 'used_at_work', ref: `${day}:second-look`, data: { source: 'second_look', minutes: 5, ...(input.taskId ? { taskId: input.taskId } : {}) }, at: now.toISOString() }),
    { current: taken.profile },
  );
  return { document, marks, freeLeft: freeLeft(after, now), pointsAwarded: awards };
}
