import { createHash } from 'node:crypto';
import { localDay, type RepRecord, type RepsProfile } from '@/domain/reps';
import type { Locale, Profile, RepType } from '@/domain/types';
import { getT } from '@/i18n/messages';
import { callModel } from '@/server/ai/client';
import { reviewKitPrompt, reviewKitSchema, type ReviewFacts, type ReviewKitDraft, type ReviewRep } from '@/server/ai/prompts/review-kit';
import type { Actor } from '@/server/ai/budget';
import { emit } from '@/server/events';
import { updateProfile } from '@/server/profile';
import { HttpError } from '@/server/profile/http';
import { readRep } from '@/server/reps/records';
import { loadBundle, readXray } from '@/server/xray';
import { getRelated } from '@/server/xray/data';
import { doneReps, summaryPhrase, unitScore } from './core';
import { labelOf, occupationTitle, taskLabels } from './history';
import type { ReviewKitResponse, ReviewKitSection } from './types';

/**
 * Review kit (05.1.3): a one-page brief for a talk with one's manager. The model writes three sections
 * from the person's facts (review.kit); code checks every item (each number must appear in the facts,
 * each task must be one of theirs) and drops the ones that fail; headings, order and the Evidence list
 * are code. Identical facts hit the model cache, so reopening the brief costs nothing.
 */

const REPS_IN_FACTS = 12;
const EVIDENCE_ITEMS = 8;
const MAX_ITEMS = 3;
const MAX_TEXT = 260;
const WEEK_HOURS = 40;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Numbers written in a text, normalised (decimal comma → point, no trailing zeros). */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(',', '.'));
    if (Number.isFinite(n)) out.push(String(n));
  }
  return out;
}

/**
 * Keeps an item only when every number in it appears in the facts and its task is one of the person's.
 * Returns the kept items and how many were dropped.
 */
export function checkDraft(draft: ReviewKitDraft, facts: string, taskIds: ReadonlySet<string>): { draft: ReviewKitDraft; dropped: number } {
  const allowed = new Set(numbersIn(facts));
  let dropped = 0;
  const ok = (text: string, taskId?: string) => {
    const clean = oneLine(text);
    const good = clean.length > 0 && numbersIn(clean).every((n) => allowed.has(n)) && (taskId === undefined || taskIds.has(taskId));
    if (!good) dropped += 1;
    return good;
  };
  const trim = <T extends { text: string }>(items: T[]) => items.slice(0, MAX_ITEMS).map((i) => ({ ...i, text: clip(oneLine(i.text), MAX_TEXT) }));
  return {
    draft: {
      changed: trim(draft.changed.filter((i) => ok(i.text, i.taskId))),
      judgment: trim(draft.judgment.filter((i) => ok(i.text, i.taskId))),
      next: trim(draft.next.filter((i) => ok(i.text))),
    },
    dropped,
  };
}

/** What the person caught in a rep, from its stored review (mistakes found, traps caught, moves made). */
function caughtIn(rec: RepRecord | null): string[] {
  if (!rec?.result) return [];
  const r = rec.result;
  if (rec.type === 'slip') {
    const errors = rec.reveal?.errors ?? rec.slip?.errors ?? [];
    return errors.filter((_, i) => r.errorsFound?.[i]).map((e) => clip(oneLine(`${e.type}: ${e.explanation}`), 160));
  }
  if (rec.type === 'delegate') {
    const traps = rec.reveal?.traps ?? rec.delegate?.traps ?? [];
    const caught = new Set(r.trapsCaught ?? []);
    return traps.filter((t) => caught.has(t.id)).map((t) => clip(oneLine(t.description), 160));
  }
  const rubric = new Map((rec.edge?.criteria ?? []).map((c) => [c.id, c.text]));
  return (r.criteria ?? []).filter((c) => c.status === 'met' && rubric.has(c.id)).map((c) => clip(oneLine(rubric.get(c.id)!), 160));
}

function whatHappened(type: RepType, params: Record<string, string | number>): string {
  if (type === 'slip') return `found ${params.found ?? 0} of ${params.total ?? 0} mistakes in an AI-drafted ${params.doc ?? 'document'}`;
  if (type === 'delegate') return `covered ${params.met ?? 0} of ${params.criteria ?? 0} points in my instructions and caught ${params.traps ?? 0} of ${params.trapsTotal ?? 0} traps`;
  return `made ${params.met ?? 0} of ${params.criteria ?? 0} key moves in the conversation`;
}

export interface ReviewInput {
  facts: ReviewFacts;
  occupation: string;
  evidence: { day: string; type: RepType; task: string; summaryKey: string; summaryParams: Record<string, string | number>; score: number }[];
  repCount: number;
  firstDay: string | null;
}

/** Facts for the brief: the latest week map, recent reps with what was caught, work use and the nearest job. */
export async function reviewInput(profile: Profile, locale: Locale): Promise<ReviewInput> {
  const xray = profile.lastXrayId ? await readXray(profile.lastXrayId).catch(() => null) : null;
  if (!xray || xray.profileId !== profile.id) throw new HttpError(409, 'no_xray', 'Make your week map first.');
  const bundle = await loadBundle(xray.occupationCode);
  if (!bundle) throw new HttpError(409, 'no_xray', 'The occupation of this week map is no longer in the data.');
  const done = doneReps(profile.repLog);
  if (!done.length || !profile.proof.length) throw new HttpError(409, 'no_proof', 'Complete a rep first: the brief is built from your proof.');

  const labels = await taskLabels([bundle.code, ...profile.proof.map((p) => p.occupationCode)], 'en');
  const local = locale === 'en' ? labels : await taskLabels([bundle.code, ...profile.proof.map((p) => p.occupationCode)], locale);
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const tasks = xray.shares.flatMap((s) => {
    const t = byId.get(s.taskId);
    if (!t) return [];
    return [{ id: t.id, label: labelOf(local, bundle.code, t.id) || labelOf(labels, bundle.code, t.id), text: clip(oneLine(t.text), 200), category: t.evidence.category, hours: Math.round(((s.share * WEEK_HOURS) / 100) * 10) / 10 }];
  });

  const recent = done.slice(-REPS_IN_FACTS);
  const records = await Promise.all(recent.map((r) => readRep(r.id).then((h) => h?.rep ?? null).catch(() => null)));
  const proofByRep = new Map(profile.proof.map((p) => [p.repId, p]));
  const reps: ReviewRep[] = recent.map((r, i) => {
    const proof = proofByRep.get(r.id);
    return {
      day: r.day,
      type: r.type,
      taskId: r.taskId,
      score: Math.round(unitScore(r.score) * 100),
      what: proof ? whatHappened(r.type, summaryPhrase(proof).params) : 'completed',
      caught: caughtIn(records[i]),
    };
  });
  // Rep tasks outside the current week (an older map) still belong in the facts.
  for (const r of reps) {
    if (tasks.some((t) => t.id === r.taskId)) continue;
    const code = proofByRep.get(recent.find((x) => x.taskId === r.taskId)?.id ?? '')?.occupationCode ?? bundle.code;
    const src = code === bundle.code ? byId.get(r.taskId) : (await loadBundle(code).catch(() => null))?.tasks.find((t) => t.id === r.taskId);
    if (src) tasks.push({ id: src.id, label: labelOf(local, code, src.id) || labelOf(labels, code, src.id), text: clip(oneLine(src.text), 200), category: src.evidence.category, hours: 0 });
  }

  const work = new Map<string, { times: number; minutes: number }>();
  for (const w of (profile as RepsProfile).workLog ?? []) {
    const cur = work.get(w.taskId) ?? { times: 0, minutes: 0 };
    work.set(w.taskId, { times: cur.times + 1, minutes: cur.minutes + w.minutes });
  }
  const rel = (await getRelated(bundle.code).catch(() => []))[0] ?? bundle.related[0] ?? null;

  const evidence = [...profile.proof]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, EVIDENCE_ITEMS)
    .map((e) => {
      const ph = summaryPhrase(e);
      return {
        day: profile.repLog.find((r) => r.id === e.repId)?.day ?? e.at.slice(0, 10),
        type: e.type,
        task: labelOf(local, e.occupationCode, e.taskId),
        summaryKey: ph.key,
        summaryParams: ph.params,
        score: Math.round(unitScore(e.score) * 100),
      };
    });

  return {
    facts: {
      occupation: bundle.title,
      tasks,
      reps,
      work: [...work].filter(([id]) => tasks.some((t) => t.id === id)).map(([taskId, v]) => ({ taskId, ...v })),
      neighbour: rel ? { title: rel.title, skills: rel.missingSkills.slice(0, 4) } : null,
    },
    occupation: await occupationTitle(bundle, locale),
    evidence,
    repCount: done.length,
    firstDay: done[0]?.day ?? null,
  };
}

/** Builds the brief. Points (`review_kit`) by the 04.1 rules: at most once in 30 days. */
export async function buildReviewKit(profile: Profile, locale: Locale, actor: Actor): Promise<ReviewKitResponse> {
  const input = await reviewInput(profile, locale);
  const user = reviewKitPrompt.user(input.facts);
  const res = await callModel({
    op: 'review.kit',
    schema: reviewKitSchema,
    system: reviewKitPrompt.system(locale),
    user,
    locale,
    // no cache: the brief is built from this person's own record, for this request only
    maxTokens: 1800,
    temperature: 0.3,
    actor,
  });
  const taskIds = new Set(input.facts.tasks.map((t) => t.id));
  const checked = checkDraft(res.data, user, taskIds);
  if (checked.dropped) console.info(`[review-kit] dropped ${checked.dropped} item(s) that did not match the facts`);

  const t = getT(locale);
  const fallbackChanged = input.facts.tasks
    .filter((x) => (x.category === 'ai_does' || x.category === 'ai_speeds') && input.facts.reps.some((r) => r.taskId === x.id) && x.hours > 0)
    .slice(0, 2)
    .map((x) => t('progress.kit.fallbackChanged', { task: x.label, hours: x.hours }));
  const date = (day: string) => t.f.date(`${day}T12:00:00Z`, 'medium');
  const evidence = input.evidence.map((e) =>
    t('progress.kit.evidenceItem', { date: date(e.day), type: t(`progress.type.${e.type}`), task: e.task, summary: t(e.summaryKey, e.summaryParams), score: e.score }),
  );

  const sections: ReviewKitSection[] = [
    { key: 'changed', title: t('progress.kit.changed'), items: checked.draft.changed.length ? checked.draft.changed.map((i) => i.text) : fallbackChanged },
    { key: 'judgment', title: t('progress.kit.judgment'), items: checked.draft.judgment.map((i) => i.text) },
    { key: 'next', title: t('progress.kit.next'), items: checked.draft.next.map((i) => i.text) },
    { key: 'evidence', title: t('progress.kit.evidence'), items: evidence },
  ].filter((s) => s.items.length > 0) as ReviewKitSection[];

  const now = new Date();
  const title = t('progress.kit.docTitle', { job: input.occupation });
  // the person's own calendar day, not the server's
  const today = date(localDay(now, profile.tz));
  const subtitle = input.firstDay
    ? t('progress.kit.docSubtitle', { count: input.repCount, since: date(input.firstDay), today })
    : t('progress.kit.docSubtitleToday', { today });
  const markdown = [`# ${title}`, '', subtitle, '', ...sections.flatMap((s) => [`## ${s.title}`, '', ...s.items.map((i) => `- ${i}`), ''])].join('\n').trim() + '\n';

  const ref = createHash('sha256').update(user).digest('hex').slice(0, 16);
  const { awards } = await updateProfile(profile.id, (p) => emit(p, { type: 'review_kit', ref, data: { cached: res.cached } }), { current: profile });

  return { title, subtitle, sections, markdown, generatedAt: now.toISOString(), dropped: checked.dropped, pointsAwarded: awards };
}
