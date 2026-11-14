import { randomBytes } from 'node:crypto';
import { localDay } from '@/domain/reps';
import { levelOf, xpOf } from '@/domain/points';
import { computeXray } from '@/domain/xray';
import type { Locale, PointsAward, Profile, ProofEntry, RepType } from '@/domain/types';
import { emit } from '@/server/events';
import { getProfile, updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { getStore, isConflictError } from '@/server/store';
import { loadBundle, practiceOf, readXray } from '@/server/xray';
import { doneReps, summaryPhrase, unitScore } from './core';
import { labelOf, occupationTitle, taskLabels } from './history';
import type { PublicPortfolio } from './types';

/**
 * The public proof page (05.1.2). A profile gets a slug the first time one of its entries is made public:
 * `pslug:<slug>` → `{ profileId }`. The slug is random (no name, no profile id), and the page reads the
 * profile behind it on every request, so a deleted profile or a page turned private disappears at once.
 */

export const slugKey = (slug: string) => `pslug:${slug}`;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const SLUG_RE = /^[0-9A-Za-z]{10}$/;
export const isSlug = (v: unknown): v is string => typeof v === 'string' && SLUG_RE.test(v);

function newSlug(): string {
  let out = '';
  while (out.length < 10) for (const b of randomBytes(20)) if (b < 248 && out.length < 10) out += BASE62[b % 62];
  return out;
}

/** Reserves a fresh slug for this profile (a key that did not exist). */
async function reserveSlug(profileId: string): Promise<string> {
  const store = getStore();
  for (let i = 0; i < 4; i++) {
    const slug = newSlug();
    try {
      await store.set(slugKey(slug), { profileId }, { version: 0 });
      return slug;
    } catch (err) {
      if (!isConflictError(err)) throw err;
    }
  }
  throw new Error('could not allocate a proof slug');
}

/** PATCH /api/proof/:id { public }: marks one entry public or private; the first public entry creates the slug. */
export async function setProofPublic(profile: Profile, entryId: string, value: boolean): Promise<{ entry: ProofEntry; publicSlug: string | null }> {
  if (!profile.proof.some((e) => e.id === entryId)) throw new HttpError(404, 'not_found', 'Proof entry not found.');
  const reserved = value && !profile.publicSlug ? await reserveSlug(profile.id) : null;
  let entry: ProofEntry | null = null;
  const { profile: next } = await updateProfile(
    profile.id,
    (p) => {
      const e = p.proof.find((x) => x.id === entryId);
      if (!e) throw new HttpError(404, 'not_found', 'Proof entry not found.');
      e.public = value;
      if (value && !p.publicSlug && reserved) p.publicSlug = reserved;
      entry = { ...e };
    },
    { current: profile },
  );
  // Another request set a slug first: the one reserved here stays unused.
  if (reserved && next.publicSlug !== reserved) await getStore().del(slugKey(reserved)).catch(() => undefined);
  return { entry: entry!, publicSlug: next.publicSlug ?? null };
}

/** POST /api/proof/share: the public link, and `proof_shared` (points at most once a week by the 04.1 rules). */
export async function shareProof(profile: Profile, origin: string, tz: string | null): Promise<{ url: string; slug: string; pointsAwarded: PointsAward[] }> {
  const slug = profile.publicSlug;
  if (!slug || !profile.proof.some((e) => e.public)) throw new HttpError(409, 'nothing_public', 'Make at least one entry public first.');
  const day = localDay(new Date(), profile.tz ?? tz);
  const { awards } = await updateProfile(profile.id, (p) => emit(p, { type: 'proof_shared', ref: `${slug}:${day}`, data: { slug } }), { current: profile });
  return { url: `${origin}/p/${slug}`, slug, pointsAwarded: awards };
}

/**
 * The page behind a slug, or null (unknown slug, deleted profile, slug replaced). Only public entries,
 * no personal data: the O*NET occupation title instead of the person's own job title, no pay, no résumé.
 */
export async function readPublicPortfolio(slug: string, locale: Locale): Promise<PublicPortfolio | null> {
  if (!isSlug(slug)) return null;
  const hit = await getStore().get<{ profileId: string }>(slugKey(slug));
  if (!hit) return null;
  const profile = await getProfile(hit.value.profileId);
  if (!profile || profile.publicSlug !== slug) return null;

  const xray = profile.lastXrayId ? await readXray(profile.lastXrayId).catch(() => null) : null;
  const code = xray?.occupationCode ?? profile.occupationCode ?? profile.proof.at(-1)?.occupationCode ?? null;
  const bundle = code ? await loadBundle(code).catch(() => null) : null;
  const score = xray && bundle && xray.profileId === profile.id ? computeXray(bundle, xray.shares, { practice: practiceOf(profile) }).result.score : null;

  const done = doneReps(profile.repLog);
  const byType: Record<RepType, number> = { slip: 0, delegate: 0, edge: 0 };
  for (const r of done) byType[r.type] += 1;

  const shown = profile.proof.filter((e) => e.public).sort((a, b) => b.at.localeCompare(a.at));
  const labels = await taskLabels(shown.map((e) => e.occupationCode), locale);
  const dayOf = new Map(profile.repLog.map((r) => [r.id, r.day]));
  return {
    slug,
    occupationTitle: bundle ? await occupationTitle(bundle, locale) : '',
    score,
    reps: done.length,
    byType,
    since: profile.createdAt,
    level: (({ level, label }) => ({ level, label }))(levelOf(xpOf(profile))),
    card: xray && xray.profileId === profile.id ? { id: xray.id, version: xray.version, updatedAt: xray.updatedAt, jobTitle: xray.jobTitle } : null,
    entries: shown.map((e) => {
      const summary = summaryPhrase(e);
      return {
        id: e.id,
        type: e.type,
        taskId: e.taskId,
        taskShort: labelOf(labels, e.occupationCode, e.taskId),
        score: Math.round(unitScore(e.score) * 100),
        summary,
        at: e.at,
        day: dayOf.get(e.repId) ?? e.at.slice(0, 10),
      };
    }),
  };
}
