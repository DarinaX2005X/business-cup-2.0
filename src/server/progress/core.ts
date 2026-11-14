import { addDays } from '@/domain/reps';
import type { Profile, ProofEntry, RepType, WeekShare } from '@/domain/types';
import type { CalendarDay, Phrase, ScorePoint } from './types';

/**
 * Pure parts of the Progress page (05.1.1): the 12-week calendar, the score line, the counters and the
 * wording of proof entries. No I/O, so tests feed them plain records.
 */

export const CALENDAR_WEEKS = 12;
/** A task counts as «practised well» after this many reps scoring at least GOOD_SCORE. */
export const GOOD_REPS = 2;
export const GOOD_SCORE = 0.7;
const WEEK_HOURS = 40;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Monday of the week that contains `day` (YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  return addDays(day, 1 - dow);
}

/**
 * The last CALENDAR_WEEKS weeks, Monday first, ending with the week of `today`: one cell per day with the
 * number of reps finished that day. Days after today and before the profile existed are marked.
 */
export function calendarFrom(repDays: ReadonlyMap<string, number>, today: string, createdDay: string, weeks = CALENDAR_WEEKS): CalendarDay[] {
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const day = addDays(start, i);
    return { day, reps: repDays.get(day) ?? 0, future: day > today, before: day < createdDay };
  });
}

/** Rep scores are stored 0..1; older values above 1 are percentages. */
export const unitScore = (s: number) => (s > 1 ? Math.min(1, s / 100) : Math.max(0, s));

type LogEntry = Profile['repLog'][number];
export const doneReps = (log: readonly LogEntry[]) => log.filter((r): r is LogEntry & { score: number } => typeof r.score === 'number' && Number.isFinite(r.score));

/** Days with finished reps and how many on each. */
export function repDaysOf(log: readonly LogEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of doneReps(log)) out.set(r.day, (out.get(r.day) ?? 0) + 1);
  return out;
}

/**
 * Hours of the current week in tasks the person has practised well: a task counts when it has at least
 * GOOD_REPS reps scoring GOOD_SCORE or more; its hours are its share of a 40-hour week.
 */
export function hoursPractised(shares: readonly WeekShare[] | undefined, log: readonly LogEntry[]): number {
  if (!shares?.length) return 0;
  const good = new Map<string, number>();
  for (const r of doneReps(log)) if (unitScore(r.score) >= GOOD_SCORE) good.set(r.taskId, (good.get(r.taskId) ?? 0) + 1);
  let hours = 0;
  for (const s of shares) if ((good.get(s.taskId) ?? 0) >= GOOD_REPS) hours += (s.share * WEEK_HOURS) / 100;
  return round1(hours);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** AI mistakes the person caught: planted mistakes found in Spot the slip plus traps caught in Delegate. */
export function caughtCount(proof: readonly ProofEntry[]): number {
  let n = 0;
  for (const e of proof) {
    if (e.type === 'slip') n += num(e.summaryParams.found);
    else if (e.type === 'delegate') n += num(e.summaryParams.traps);
  }
  return n;
}

const SUMMARY_KEYS: Record<string, string> = {
  'proof.slip': 'progress.proof.slip',
  'proof.delegate': 'progress.proof.delegate',
  'proof.edge': 'progress.proof.edge',
};

/** The sentence under a proof entry, as a dictionary key with params (`workMinutes` is reported apart). */
export function summaryPhrase(entry: Pick<ProofEntry, 'summaryKey' | 'summaryParams' | 'score' | 'type'>): Phrase {
  const key = SUMMARY_KEYS[entry.summaryKey];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { workMinutes, ...params } = entry.summaryParams;
  if (!key) return { key: 'progress.proof.generic', params: { score: Math.round(unitScore(entry.score) * 100) } };
  if (entry.type === 'slip' && typeof params.doc === 'string') params.doc = params.doc.trim();
  return { key, params };
}

export const workMinutesOf = (entry: Pick<ProofEntry, 'summaryParams'>) => num(entry.summaryParams.workMinutes);

// ---------------------------------------------------------------------------------------------
// Score line

export interface MapInput {
  id: string;
  jobTitle: string;
  createdAt: string;
  createdDay: string;
  /** Set when the week was changed after it was made (only the latest change is known). */
  editedAt: string | null;
  editedDay: string | null;
  /** The map's score (one decimal) with a given practice: used where no rep recorded the score. */
  exactWith(practice: { n: number; avgScore: number }): number;
}

export interface RepInput {
  id: string;
  at: string;
  day: string;
  type: RepType;
  taskId: string;
  taskShort: string;
  /** 0..1 */
  score: number;
  summary: Phrase;
  /** The map score before and after this rep, as recorded when it was checked. */
  change: { from: number; to: number; fromExact: number; toExact: number } | null;
}

type Ev = { kind: 'map'; at: string; map: MapInput } | { kind: 'edit'; at: string; map: MapInput } | { kind: 'rep'; at: string; rep: RepInput };

/**
 * Points of the score line in time order. A rep point is the score recorded when the rep was checked
 * (true history, whatever the week looked like then). A map or edit point takes the score the next rep
 * started from when that rep came before any other change; otherwise the score is computed from the map
 * with the practice done until then.
 */
export function scoreHistoryFrom(maps: readonly MapInput[], reps: readonly RepInput[]): ScorePoint[] {
  const events: Ev[] = [];
  const sortedMaps = [...maps].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const map of sortedMaps) events.push({ kind: 'map', at: map.createdAt, map });
  const latest = sortedMaps.at(-1);
  if (latest?.editedAt) events.push({ kind: 'edit', at: latest.editedAt, map: latest });
  for (const rep of reps) {
    // A rep checked without a week map has no score to show (both ends 0).
    if (!rep.change || (rep.change.fromExact === 0 && rep.change.toExact === 0)) continue;
    events.push({ kind: 'rep', at: rep.at, rep });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || order(a) - order(b));

  const points: ScorePoint[] = [];
  const scores: number[] = [];
  let hasMap = false;
  events.forEach((ev, i) => {
    if (ev.kind === 'rep') {
      const { rep } = ev;
      const c = rep.change!;
      scores.push(rep.score);
      if (!hasMap) return; // reps before the first map in view: counted in practice, not drawn
      points.push({
        id: `rep:${rep.id}`,
        kind: 'rep',
        at: rep.at,
        day: rep.day,
        score: c.to,
        exact: round1(c.toExact),
        before: c.from,
        type: rep.type,
        taskId: rep.taskId,
        taskShort: rep.taskShort,
        reason: rep.summary,
      });
      return;
    }
    hasMap = true;
    const next = events[i + 1];
    const practice = { n: scores.length, avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0 };
    const exact = next?.kind === 'rep' && next.rep.change ? next.rep.change.fromExact : ev.map.exactWith(practice);
    points.push({
      id: `${ev.kind}:${ev.map.id}`,
      kind: ev.kind,
      at: ev.at,
      day: ev.kind === 'map' ? ev.map.createdDay : (ev.map.editedDay ?? ev.map.createdDay),
      score: Math.round(exact),
      exact: round1(exact),
      reason: ev.kind === 'map' ? { key: 'progress.reason.map', params: { job: ev.map.jobTitle } } : { key: 'progress.reason.edit', params: {} },
    });
  });
  return points;
}

const order = (e: Ev) => (e.kind === 'map' ? 0 : e.kind === 'edit' ? 1 : 2);
