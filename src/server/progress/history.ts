import { PRACTICE_GAIN } from '@/domain/constants';
import { applyFreeze } from '@/domain/points';
import { localDay, streakAsOf, type RepRecord } from '@/domain/reps';
import { computeXray, practiceScore } from '@/domain/xray';
import type { Locale, OccupationBundle, Profile, XrayResult } from '@/domain/types';
import { isPro } from '@/server/profile';
import { readRep } from '@/server/reps/records';
import { getTaskTexts, heuristicShort, loadBundle, practiceOf, readXray } from '@/server/xray';
import { getLocalTitles } from '@/server/xray/data';
import {
  calendarFrom,
  caughtCount,
  doneReps,
  hoursPractised,
  repDaysOf,
  scoreHistoryFrom,
  summaryPhrase,
  unitScore,
  workMinutesOf,
  type MapInput,
  type RepInput,
} from './core';
import type { ProgressResponse, ProofView } from './types';

/** Reps read for the score line (newest first); older ones still count in the totals. */
const HISTORY_REPS = 60;
/** Week maps drawn on the line (newest first). */
const HISTORY_MAPS = 6;

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Short task labels in the visitor's language, per occupation (same precedence as the rep captions). */
export async function taskLabels(codes: Iterable<string>, locale: Locale): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  await Promise.all(
    [...new Set(codes)].map(async (code) => {
      const [bundle, texts] = await Promise.all([loadBundle(code).catch(() => null), getTaskTexts(code, locale).catch(() => null)]);
      const m = new Map<string, string>();
      for (const task of bundle?.tasks ?? []) {
        const short = (locale === 'en' ? task.short : undefined) || texts?.tasks[task.id]?.short || task.short || heuristicShort(task.text);
        m.set(task.id, short);
      }
      out.set(code, m);
    }),
  );
  return out;
}

export const labelOf = (labels: Map<string, Map<string, string>>, code: string, taskId: string) => labels.get(code)?.get(taskId) ?? '';

/** Occupation title in the visitor's language when the build has one. */
export async function occupationTitle(bundle: Pick<OccupationBundle, 'code' | 'title'>, locale: Locale): Promise<string> {
  const local = await getLocalTitles(locale).catch(() => null);
  return local?.get(bundle.code) ?? bundle.title;
}

/** Exact (one decimal) score of a map with a given practice: the same formula the rep check records. */
function exactScore(bundle: OccupationBundle, xray: XrayResult, salary: number | null, practice: { n: number; avgScore: number }): number {
  const { baseScore } = computeXray(bundle, xray.shares, { salary, practice }).result;
  const { F } = practiceScore(baseScore, practice);
  return round1(baseScore + (100 - baseScore) * PRACTICE_GAIN * F);
}

/**
 * GET /api/progress for one profile: the score line, streak calendar, counters and proof list.
 * Reads the latest maps and the recent rep records (their recorded score change is the line's history).
 */
export async function buildProgress(profile: Profile, opts: { tz?: string | null; locale?: Locale; now?: Date } = {}): Promise<ProgressResponse> {
  const now = opts.now ?? new Date();
  const tz = profile.tz ?? opts.tz ?? null;
  const locale = opts.locale ?? profile.locale;
  const today = localDay(now, tz);
  const createdDay = localDay(new Date(profile.createdAt), tz);
  const done = doneReps(profile.repLog);
  const dayOfRep = new Map(profile.repLog.map((r) => [r.id, r.day]));

  // Week maps: the latest one decides the current score; up to HISTORY_MAPS are drawn.
  const mapIds = profile.xrays.slice(-HISTORY_MAPS);
  const xrays = (await Promise.all(mapIds.map((id) => readXray(id).catch(() => null)))).filter((x): x is XrayResult => !!x && x.profileId === profile.id);
  const bundles = new Map<string, OccupationBundle>();
  await Promise.all(
    [...new Set(xrays.map((x) => x.occupationCode))].map(async (code) => {
      const b = await loadBundle(code).catch(() => null);
      if (b) bundles.set(code, b);
    }),
  );
  const latest = xrays.find((x) => x.id === profile.lastXrayId) ?? xrays.at(-1) ?? null;
  const latestBundle = latest ? bundles.get(latest.occupationCode) : undefined;
  const salary = profile.salary ?? null;
  const current = latest && latestBundle ? computeXray(latestBundle, latest.shares, { salary, practice: practiceOf(profile) }).result : null;

  // Labels for every occupation that appears in the proof and the maps.
  const codes = new Set<string>([...profile.proof.map((p) => p.occupationCode), ...xrays.map((x) => x.occupationCode)]);
  const labels = await taskLabels(codes, locale);

  // Rep records: the score change recorded at check time.
  const recent = done.slice(-HISTORY_REPS);
  const records = await Promise.all(recent.map((r) => readRep(r.id).then((h) => h?.rep ?? null).catch(() => null)));
  const proofByRep = new Map(profile.proof.map((p) => [p.repId, p]));
  const repInputs: RepInput[] = [];
  recent.forEach((r, i) => {
    const rec: RepRecord | null = records[i];
    const proof = proofByRep.get(r.id);
    const code = rec?.occupationCode ?? proof?.occupationCode ?? profile.occupationCode ?? '';
    const sc = rec?.result?.scoreChange;
    repInputs.push({
      id: r.id,
      at: rec?.completedAt ?? proof?.at ?? `${r.day}T12:00:00.000Z`,
      day: r.day,
      type: r.type,
      taskId: r.taskId,
      taskShort: labelOf(labels, code, r.taskId),
      score: unitScore(r.score),
      summary: proof ? summaryPhrase(proof) : { key: 'progress.proof.generic', params: { score: Math.round(unitScore(r.score) * 100) } },
      change: sc ? { from: sc.from ?? sc.before, to: sc.to ?? sc.after, fromExact: sc.fromExact ?? sc.before, toExact: sc.toExact ?? sc.after } : null,
    });
  });

  const maps: MapInput[] = xrays.flatMap((x) => {
    const bundle = bundles.get(x.occupationCode);
    if (!bundle) return [];
    const edited = x.id === latest?.id && x.version > 1 && Date.parse(x.updatedAt) - Date.parse(x.createdAt) > 60_000;
    return [
      {
        id: x.id,
        jobTitle: x.jobTitle,
        createdAt: x.createdAt,
        createdDay: localDay(new Date(x.createdAt), tz),
        editedAt: edited ? x.updatedAt : null,
        editedDay: edited ? localDay(new Date(x.updatedAt), tz) : null,
        exactWith: (practice) => exactScore(bundle, x, salary, practice),
      },
    ];
  });
  const history = scoreHistoryFrom(maps, repInputs);

  const proof: ProofView[] = [...profile.proof]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({
      id: e.id,
      repId: e.repId,
      type: e.type,
      taskId: e.taskId,
      taskShort: labelOf(labels, e.occupationCode, e.taskId),
      occupationCode: e.occupationCode,
      score: Math.round(unitScore(e.score) * 100),
      summary: summaryPhrase(e),
      at: e.at,
      day: dayOfRep.get(e.repId) ?? localDay(new Date(e.at), tz),
      public: e.public,
      workMinutes: workMinutesOf(e),
    }));

  const firstMap = history.find((p) => p.kind === 'map');
  return {
    hasMap: !!current,
    xrayId: latest?.id ?? null,
    occupationTitle: latestBundle ? await occupationTitle(latestBundle, locale) : null,
    score: current?.score ?? null,
    startScore: firstMap?.score ?? null,
    history,
    streak: {
      // a streak freeze covers missed days on reading, as on Today
      current: streakAsOf(applyFreeze(profile.streak, today).streak, today).current,
      best: profile.streak.best,
      today,
      calendar: calendarFrom(repDaysOf(profile.repLog), today, createdDay),
    },
    counts: { reps: done.length, caught: caughtCount(profile.proof), hoursPractised: hoursPractised(latest?.shares ?? profile.shares, profile.repLog) },
    proof,
    publicSlug: profile.publicSlug ?? null,
    publicCount: profile.proof.filter((e) => e.public).length,
    isPro: isPro(profile),
  };
}
