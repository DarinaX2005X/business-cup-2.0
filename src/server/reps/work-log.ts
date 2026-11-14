import { randomBytes } from 'node:crypto';
import { localDay, type RepsProfile, type WorkLogEntry } from '@/domain/reps';
import type { PointsAward, Profile } from '@/domain/types';
import { emit } from '@/server/events';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { loadBundle } from '@/server/xray';

/**
 * "I used this at work": up to 3 entries a day, 5–240 minutes each, for a task of the person's
 * occupation. Stored in `profile.workLog` (hours for the Review kit) and added to the latest proof
 * entry of that task as `workMinutes`; emits `used_at_work` (points come from stage 04 subscribers).
 */

export const WORK_LOG_PER_DAY = 3;
const LOG_KEEP = 200;

export async function logWork(
  profile: Profile,
  tz: string | null,
  body: { taskId: string; minutes: number },
  now = new Date(),
): Promise<{ entry: WorkLogEntry; pointsAwarded: PointsAward[]; minutesToday: number }> {
  if (!profile.occupationCode) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  const bundle = await loadBundle(profile.occupationCode);
  if (!bundle?.tasks.some((t) => t.id === body.taskId)) throw new HttpError(400, 'invalid_input', 'taskId: not a task of your occupation');
  const day = localDay(now, profile.tz ?? tz);
  const entry: WorkLogEntry = { id: randomBytes(6).toString('base64url'), taskId: body.taskId, minutes: body.minutes, day, at: now.toISOString() };
  let minutesToday = 0;
  const { awards } = await updateProfile(
    profile.id,
    (p) => {
      const rp = p as RepsProfile;
      const today = (rp.workLog ?? []).filter((w) => w.day === day);
      if (today.length >= WORK_LOG_PER_DAY) throw new HttpError(429, 'work_log_limit', `Up to ${WORK_LOG_PER_DAY} entries a day.`);
      rp.workLog = [...(rp.workLog ?? []), entry].slice(-LOG_KEEP);
      minutesToday = today.reduce((n, w) => n + w.minutes, 0) + entry.minutes;
      const proof = [...p.proof].reverse().find((e) => e.taskId === body.taskId);
      if (proof) {
        const prev = Number(proof.summaryParams.workMinutes ?? 0);
        proof.summaryParams.workMinutes = (Number.isFinite(prev) ? prev : 0) + entry.minutes;
      }
      return emit(p, { type: 'used_at_work', ref: `${day}:${entry.id}`, data: { taskId: body.taskId, minutes: entry.minutes } });
    },
    { current: profile },
  );
  return { entry, pointsAwarded: awards, minutesToday };
}
