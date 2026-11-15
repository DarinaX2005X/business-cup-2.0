import { randomBytes } from 'node:crypto';
import type { Profile } from '@/domain/types';
import { hashIp, type Actor } from '@/server/ai/budget';
import { DEMO_EMAIL_DOMAIN, profileByEmail } from '@/server/auth';
import { planKey, readPlan } from '@/server/growth';
import { createProfile, deleteProfile, emailIndexKey, getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { createXray, readXray } from '@/server/xray/records';
import { buildDemoMap, cupIfPossible, growDemo, later, type JuryPersona } from './jury';

/**
 * Business Cup 2.0 jury accounts. Each persona has one TEMPLATE profile (`demo-<persona>@irreplaceable.demo`),
 * built once with the live pipeline (about 30 s) under a lock. The template is never handed out: every click
 * gets its own private COPY of it, made in a moment without model calls, with its own week map (a new id it
 * owns), skills, the written 90-day plan, Max until Nov 30, `demo: true` and a fresh secret. So one visitor
 * cannot change what the next one sees, and reps, AI or me, the coach and its limits are their own.
 */

export const demoEmail = (persona: JuryPersona) => `demo-${persona}@${DEMO_EMAIL_DOMAIN}`;

/** Time zone of each sample résumé's city, so "today" matches the persona. */
export const PERSONA_TZ: Record<JuryPersona, string> = { nurse: 'America/Chicago', software: 'America/Chicago', accountant: 'America/New_York' };
/** A password hash value that never matches (not in the scrypt format). */
const NO_PASSWORD = 'none';

const LOCK_SEC = 180;
const WAIT_MS = 100_000;
const POLL_MS = 1_500;

/** Copies per IP and hour: judges share one network, so it is generous; it only stops a script. */
export const DEMO_OPENS_PER_HOUR = 60;

export interface DemoAccount {
  id: string;
  secret: string;
  email: string;
  /** the week map of this copy */
  xrayId: string | null;
  /** always true: every click makes a new private copy */
  created: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 once an IP has opened DEMO_OPENS_PER_HOUR copies this hour (DEMO_OPENS_PER_HOUR env overrides). */
export async function takeDemoOpen(ip: string | null | undefined, now: Date = new Date()): Promise<void> {
  if (!ip) return;
  const limit = Number(process.env.DEMO_OPENS_PER_HOUR) || DEMO_OPENS_PER_HOUR;
  const hour = now.toISOString().slice(0, 13);
  const key = `rl:demo:${hashIp(ip)}:${hour}`;
  const store = getStore();
  const n = await store.incrFloat(key, 1, 2 * 3600);
  if (n > limit) {
    await store.incrFloat(key, -1);
    throw new HttpError(429, 'rate_limited', 'Too many demo accounts from this network for now. Try again within the hour.');
  }
}

/** The persona's finished template, or null. Its skills and plan are written after the response if missing. */
async function readyTemplate(persona: JuryPersona, actor: Actor): Promise<Profile | null> {
  const profile = await profileByEmail(demoEmail(persona));
  if (!profile) return null;
  const xrayId = profile.demoXrays?.[persona] ?? profile.lastXrayId ?? null;
  // a template built before skills and the plan were part of the build gets them now (once, under a lock)
  if (xrayId && !profile.skills?.items.length) later(() => growDemo(profile.id, persona, xrayId, { ...actor, profileId: profile.id }).catch(() => undefined));
  // templates were once handed out: mark older ones, and take them off this week's board
  if (!profile.demoTemplate) {
    later(async () => {
      await updateProfile(profile.id, (p) => {
        p.demoTemplate = true;
        // the devices it was once handed to lose it; a new click gives them a private copy
        p.secretHashes = [];
      }).catch(() => undefined);
      await (await import('@/server/leaderboard')).removeFromBoards(profile.id).catch(() => undefined);
    });
  }
  return profile;
}

/** The template of a persona, built on the first click (a click that finds it being built waits for it). */
async function templateOf(persona: JuryPersona, actor: Actor, now: Date): Promise<Profile> {
  const ready = await readyTemplate(persona, actor);
  if (ready) return ready;

  const store = getStore();
  const lock = `lock:demo:${persona}`;
  const token = randomBytes(8).toString('hex');
  if (!(await store.setNx(lock, token, LOCK_SEC))) {
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      const done = await readyTemplate(persona, actor);
      if (done) return done;
      if (!(await store.setNx(lock, token, LOCK_SEC))) continue;
      // the builder gave up (its lock is gone): build it here
      return buildTemplate(persona, actor, now, lock, token);
    }
    throw new HttpError(503, 'demo_unavailable', 'The demo account is still being prepared. Try again in a moment.');
  }
  return buildTemplate(persona, actor, now, lock, token);
}

async function buildTemplate(persona: JuryPersona, actor: Actor, now: Date, lock: string, token: string): Promise<Profile> {
  const store = getStore();
  try {
    const again = await readyTemplate(persona, actor); // finished elsewhere between the check and the lock
    if (again) return again;
    const email = demoEmail(persona);
    const { profile } = await createProfile({ locale: 'en', tz: PERSONA_TZ[persona] });
    try {
      await buildDemoMap(profile, persona, { ...actor, profileId: profile.id }, now);
      await updateProfile(profile.id, (p) => {
        p.account = { email, passwordHash: NO_PASSWORD, createdAt: now.toISOString() };
        p.demoTemplate = true;
        // nobody signs in to a template: no device secret is kept
        p.secretHashes = [];
      });
      try {
        await store.set(emailIndexKey(email), { profileId: profile.id, createdAt: now.toISOString() }, { version: 0 });
      } catch (err) {
        if (!isConflictError(err)) throw err;
        // another build won the email: use it and drop this one
        await deleteProfile(profile.id).catch(() => undefined);
        const theirs = await readyTemplate(persona, actor);
        if (theirs) return theirs;
        throw err;
      }
      return (await getProfile(profile.id)) ?? profile;
    } catch (err) {
      // no half-built template stays behind (its map, reps and keys go with it)
      const stillOurs = (await store.get<{ profileId: string }>(emailIndexKey(email)).catch(() => null))?.value.profileId === profile.id;
      if (!stillOurs) await deleteProfile(profile.id).catch(() => undefined);
      throw err;
    }
  } finally {
    await store.delIfEquals(lock, token).catch(() => undefined);
  }
}

/**
 * A private copy of the template for one visitor: a new profile with its own week map (same job, tasks and
 * hours), the template's skills and résumé facts, the template's plan stored under the new map, Max until
 * Nov 30 and `demo: true`. No model calls. A copy that fails halfway is deleted.
 */
async function cloneTemplate(template: Profile, persona: JuryPersona, now: Date): Promise<DemoAccount> {
  const sourceId = template.demoXrays?.[persona] ?? template.lastXrayId ?? null;
  const source = sourceId ? await readXray(sourceId) : null;
  if (!source) throw new HttpError(503, 'demo_unavailable', 'The demo account is still being prepared. Try again in a moment.');

  const { profile, secret } = await createProfile({ locale: 'en', tz: template.tz ?? PERSONA_TZ[persona] });
  const email = `demo-${persona}-${randomBytes(4).toString('hex')}@${DEMO_EMAIL_DOMAIN}`;
  try {
    // a copy is the visitor's own: it shows on the leaderboard like any profile
    const { profile: marked } = await updateProfile(profile.id, (p) => {
      p.demo = true;
      p.account = { email, passwordHash: NO_PASSWORD, createdAt: now.toISOString() };
      if (template.resumeFacts) p.resumeFacts = structuredClone(template.resumeFacts);
      if (template.skills) p.skills = structuredClone(template.skills);
    });
    const { xray } = await createXray({
      profile: marked,
      occupationCode: source.occupationCode,
      shares: source.shares,
      jobTitle: source.jobTitle,
      inputSource: source.inputSource,
      locale: 'en',
    });
    const plan = await readPlan(source.id).catch(() => null);
    if (plan) await getStore().set(planKey(xray.id), { ...plan, xrayId: xray.id, profileId: profile.id }, { version: 0 });
    const { profile: withMap } = await updateProfile(profile.id, (p) => {
      p.demoXrays = { [persona]: xray.id };
    });
    await cupIfPossible(withMap, now);
    return { id: profile.id, secret, email, xrayId: xray.id, created: true };
  } catch (err) {
    await deleteProfile(profile.id).catch(() => undefined);
    throw err;
  }
}

/** POST /api/auth/demo: the persona's template (built on the first click), then a private copy of it. */
export async function openDemoAccount(persona: JuryPersona, actor: Actor, now: Date = new Date()): Promise<DemoAccount> {
  const template = await templateOf(persona, actor, now);
  return cloneTemplate(template, persona, now);
}
