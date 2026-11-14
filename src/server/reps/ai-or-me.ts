import { buildAiOrMeRound, scoreAiOrMe, type AiOrMeLogEntry, type AiOrMeRoundFull, type RepsProfile } from '@/domain/reps';
import type { PointsAward, Profile } from '@/domain/types';
import { emit } from '@/server/events';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getTaskTexts } from '@/server/xray';
import type { Week } from './service';

/**
 * AI or me? (03.1.5): five tasks of the person's occupation a day, the same all day, answers and facts
 * included (peeking is harmless: POST only scores and awards points once per day). No model.
 */

const LOG_KEEP = 14;

export type AiOrMeView = AiOrMeRoundFull;

export async function aiOrMeFor(profile: Profile, week: Week, day: string): Promise<AiOrMeView> {
  const texts = await getTaskTexts(week.bundle.code, profile.locale).catch(() => null);
  const textMap = Object.fromEntries(Object.entries(texts?.tasks ?? {}).map(([id, t]) => [id, t.text]));
  const round = buildAiOrMeRound(week.bundle, week.shares, profile.id, day, textMap);
  const log = (profile as RepsProfile).aiOrMe?.find((l) => l.day === day);
  if (log) round.completed = { correct: log.correct, right: log.right, total: log.total };
  return round;
}

export async function submitAiOrMe(
  profile: Profile,
  week: Week,
  day: string,
  body: { roundId: string; answers: ('ai' | 'human' | null)[] },
): Promise<{ correct: boolean[]; right: number; total: number; pointsAwarded: PointsAward[] }> {
  const round = await aiOrMeFor(profile, week, day);
  if (round.completed) throw new HttpError(409, 'already_played', "You've played today's round.", { completed: round.completed });
  if (body.roundId !== round.roundId) throw new HttpError(409, 'stale_round', 'This round has changed; reload it.', { round });
  const { correct, right, total } = scoreAiOrMe(round.cards, body.answers);
  const entry: AiOrMeLogEntry = { day, roundId: round.roundId, correct, right, total };
  const { awards } = await updateProfile(
    profile.id,
    (p) => {
      const rp = p as RepsProfile;
      if (rp.aiOrMe?.some((l) => l.day === day)) throw new HttpError(409, 'already_played', "You've played today's round.");
      rp.aiOrMe = [...(rp.aiOrMe ?? []), entry].slice(-LOG_KEEP);
      return emit(p, { type: 'ai_or_me', ref: round.roundId, data: { correct: right, total } });
    },
    { current: profile },
  );
  return { correct, right, total, pointsAwarded: awards };
}
