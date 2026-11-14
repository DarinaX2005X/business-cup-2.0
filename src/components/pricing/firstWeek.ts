import { addDays, chooseTask } from '@/domain/reps';
import type { Category, OccTask, Profile, RepType, WeekShare } from '@/domain/types';

/**
 * The person's first week of Pro, computed with the reps engine's own rule (03.1.4) and without
 * generating anything: the daily type rotates by date exactly like Today's «tomorrow» preview
 * (`REP_TYPES[dayNumber % 3]` in src/server/reps/service.ts), and the task is `chooseTask` with the
 * seed the engine uses for a daily rep. Each chosen day is added to a copy of the rep log, so the
 * five-day no-repeat rule plays out across the week as it will when the reps are done.
 */

/** The engine's order (src/server/reps/service.ts REP_TYPES); the rotation depends on it. */
export const REP_TYPE_ORDER: readonly RepType[] = ['slip', 'delegate', 'edge'];

export function typeForDay(day: string): RepType {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  return REP_TYPE_ORDER[((n % REP_TYPE_ORDER.length) + REP_TYPE_ORDER.length) % REP_TYPE_ORDER.length];
}

export interface PlannedRep {
  day: string;
  type: RepType;
  taskId: string;
}

export function planFirstWeek(input: {
  profileId: string;
  tasks: readonly Pick<OccTask, 'id' | 'evidence'>[];
  shares: readonly WeekShare[];
  repLog: Profile['repLog'];
  startDay: string;
  days?: number;
}): PlannedRep[] {
  const log: Profile['repLog'] = [...input.repLog];
  const out: PlannedRep[] = [];
  for (let i = 0; i < (input.days ?? 7); i++) {
    const day = addDays(input.startDay, i);
    const type = typeForDay(day);
    const seed = `${input.profileId}:${day}:daily:0:${type}`;
    const taskId = chooseTask({ tasks: input.tasks, shares: input.shares, repLog: log, type, day, seed }) ?? input.tasks[0]?.id;
    if (!taskId) break;
    out.push({ day, type, taskId });
    log.push({ id: `planned-${i}`, taskId, type, kind: 'daily', day });
  }
  return out;
}

/** One planned day as the screen draws it. */
export interface FirstWeekDay extends PlannedRep {
  /** 2–5 word label of the task in the interface language, when generated. */
  short: string | null;
  text: string;
  category: Category;
}

export interface FirstWeekView {
  xrayId: string;
  jobTitle: string;
  score: number;
  days: FirstWeekDay[];
}
