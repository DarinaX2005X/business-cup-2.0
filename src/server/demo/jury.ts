import { readSample } from '@/content/samples';
import type { Profile } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { unlockCup } from '@/server/billing/cup';
import { getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { loadBundle } from '@/server/xray/data';
import { createXray } from '@/server/xray/records';
import { analyzeResume } from '@/server/xray/resume';
import { proposeWeek } from '@/server/xray/week';

/**
 * The week map of a demo account, built from a fictional sample résumé through the same server
 * functions as /start, with live model calls:
 *   résumé analysis (resume.parse + occupation.pick) → the top occupation → the proposed week from the
 *   résumé duties (week.map) → createXray (points included) → the Cup offer (Max) → `profile.demo`.
 * Nothing in it is prepared content; the account is labelled as a demo.
 */

export const JURY_PERSONAS = ['nurse', 'software', 'accountant'] as const;
export type JuryPersona = (typeof JURY_PERSONAS)[number];

/** Max through the Cup offer when possible; a paid plan or an ended offer keeps the plan as it is. */
async function cupIfPossible(profile: Profile, now: Date): Promise<Profile['plan']> {
  try {
    return (await unlockCup(profile, now)).plan;
  } catch (err) {
    if (err instanceof HttpError && (err.code === 'already_pro' || err.code === 'offer_ended')) return profile.plan;
    throw err;
  }
}

export async function buildDemoMap(profile: Profile, persona: JuryPersona, actor: Actor, now: Date = new Date()): Promise<{ xrayId: string; plan: Profile['plan'] }> {
  const text = await readSample(persona);
  const analysis = await analyzeResume({ text, mode: 'resume', locale: 'en', actor });
  const pick = analysis.ranked[0];
  const bundle = pick ? await loadBundle(pick.code) : null;
  if (!pick || !bundle) throw new HttpError(503, 'ai_unavailable', 'The résumé could not be matched to a job. Try again.');
  const week = await proposeWeek({ bundle, duties: analysis.facts.duties, locale: 'en', actor });
  const own = analysis.facts.title?.trim();
  const jobTitle = (own && own.length >= 2 ? own : pick.title).slice(0, 120);

  const current = (await getProfile(profile.id)) ?? profile;
  const { xray } = await createXray({
    profile: current,
    occupationCode: pick.code,
    shares: week.shares,
    jobTitle,
    inputSource: 'resume',
    locale: 'en',
    requestId: `jury-${persona}`,
  });
  const { profile: marked } = await updateProfile(profile.id, (p) => {
    p.demo = true;
    p.demoXrays = { ...p.demoXrays, [persona]: xray.id };
    p.resumeFacts = analysis.facts;
  });
  return { xrayId: xray.id, plan: await cupIfPossible(marked, now) };
}
