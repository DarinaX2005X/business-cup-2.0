import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { readSample } from '@/content/samples';
import type { Profile } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { unlockCup } from '@/server/billing/cup';
import { extractSkills, getPlan, readPlan } from '@/server/growth';
import { getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore } from '@/server/store';
import { loadBundle } from '@/server/xray/data';
import { createXray } from '@/server/xray/records';
import { analyzeResume } from '@/server/xray/resume';
import { proposeWeek } from '@/server/xray/week';

/**
 * The week map of a demo account, built from a fictional sample résumé through the same server
 * functions as /start, with live model calls:
 *   résumé analysis (resume.parse + occupation.pick) → the top occupation → the proposed week from the
 *   résumé duties (week.map) → createXray (points included) → the Cup offer (Max) → `profile.demo` →
 *   skills from the same résumé (profile.skills) → the 90-day plan (written right after the response).
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
  const plan = await cupIfPossible(marked, now);
  await growDemo(profile.id, persona, xray.id, actor);
  return { xrayId: xray.id, plan };
}

const GROW_LOCK_SEC = 150;

/** Runs work after the response when called inside a request; elsewhere (scripts, tests) at once. */
export function later(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Skills from the persona's sample résumé and the 90-day plan, so a demo account opens complete. Skills are
 * read before the account is handed out (about 15 s); the plan takes longer and is written right after the
 * response (the Plan tab shows «being written» meanwhile). Also called on sign-in for accounts built before
 * this step existed. A failure never blocks the account: the tabs write what is missing on first open.
 */
export async function growDemo(profileId: string, persona: JuryPersona, xrayId: string, actor: Actor): Promise<void> {
  const store = getStore();
  const lock = `lock:demo-grow:${profileId}`;
  const token = randomBytes(8).toString('hex');
  if (!(await store.setNx(lock, token, GROW_LOCK_SEC).catch(() => false))) return;
  let handedOff = false;
  try {
    const p = await getProfile(profileId);
    if (!p) return;
    if (!p.skills?.items.length) {
      const text = await readSample(persona);
      await extractSkills({ profile: p, text, xrayId, actor }).catch((err) => console.warn('[demo] skills failed', persona, err instanceof Error ? err.message : err));
    }
    if (await readPlan(xrayId).catch(() => null)) return;
    handedOff = true;
    later(async () => {
      try {
        const fresh = await getProfile(profileId);
        if (fresh) await getPlan({ profile: fresh, xrayId, actor });
      } catch (err) {
        console.warn('[demo] plan failed', persona, err instanceof Error ? err.message : err);
      } finally {
        await store.delIfEquals(lock, token).catch(() => undefined);
      }
    });
  } finally {
    if (!handedOff) await store.delIfEquals(lock, token).catch(() => undefined);
  }
}
