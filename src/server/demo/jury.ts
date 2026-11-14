import { randomBytes } from 'node:crypto';
import { readSample } from '@/content/samples';
import type { Profile } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { unlockCup } from '@/server/billing/cup';
import { getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';
import { loadBundle } from '@/server/xray/data';
import { createXray, readXray } from '@/server/xray/records';
import { analyzeResume } from '@/server/xray/resume';
import { proposeWeek } from '@/server/xray/week';

/**
 * Business Cup 2.0 jury account (round 3): one click builds a ready account from a fictional sample
 * résumé through the same server functions as /start, with live model calls:
 *   résumé analysis (resume.parse + occupation.pick) → the top occupation → the proposed week from the
 *   résumé duties (week.map) → createXray (points included) → the Cup offer (Coach) → `profile.demo`.
 * The account is labelled as a demo; nothing in it is prepared content. Idempotent per profile and
 * persona: a repeat returns the same map without new model calls; a parallel click gets 409 in_progress.
 */

export const JURY_PERSONAS = ['nurse', 'software', 'accountant'] as const;
export type JuryPersona = (typeof JURY_PERSONAS)[number];

const LOCK_SEC = 150;

export interface JuryResult {
  xrayId: string;
  plan: Profile['plan'];
  created: boolean;
}

/** Coach through the Cup offer when possible; a paid plan or an ended offer keeps the plan as it is. */
async function cupIfPossible(profile: Profile, now: Date): Promise<Profile['plan']> {
  try {
    return (await unlockCup(profile, now)).plan;
  } catch (err) {
    if (err instanceof HttpError && (err.code === 'already_pro' || err.code === 'offer_ended')) return profile.plan;
    throw err;
  }
}

export async function openJuryAccount(profile: Profile, persona: JuryPersona, actor: Actor, now: Date = new Date()): Promise<JuryResult> {
  const known = profile.demoXrays?.[persona];
  if (known && (await readXray(known))?.profileId === profile.id) {
    return { xrayId: known, plan: await cupIfPossible(profile, now), created: false };
  }

  const store = getStore();
  const lock = `lock:jury:${profile.id}`;
  const token = randomBytes(8).toString('hex');
  if (!(await store.setNx(lock, token, LOCK_SEC))) {
    throw new HttpError(409, 'in_progress', 'This demo account is still being set up. It takes about half a minute.');
  }
  try {
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
    const plan = await cupIfPossible(marked, now);
    return { xrayId: xray.id, plan, created: true };
  } finally {
    await store.delIfEquals(lock, token).catch(() => undefined);
  }
}
