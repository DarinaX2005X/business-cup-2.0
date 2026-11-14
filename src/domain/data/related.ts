import { RELATED } from '../constants';
import type { RelatedOccupation } from '../types';

export interface RelatedInput {
  code: string;
  slug: string;
  title: string;
  jobZone: number | null;
  typicalHumanShare: number;
  medianAnnual: number | null;
  /** element id → importance (skills and knowledge, O*NET IM 1..5) */
  importance: Map<string, number>;
  /** element id → display name */
  names: Map<string, string>;
}

/** Centred, unit-length importance vector over a fixed list of element ids; null when the occupation has none. */
export function centredVector(importance: Map<string, number>, dims: readonly string[]): Float64Array | null {
  if (!dims.some((d) => importance.has(d))) return null;
  const v = new Float64Array(dims.length);
  let mean = 0;
  dims.forEach((d, i) => {
    v[i] = importance.get(d) ?? 0;
    mean += v[i];
  });
  mean /= dims.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Neighbours of every occupation (01.1.4): cosine of centred skill+knowledge importance within Job Zone 0..+1;
 * candidates = top 30 by cosine ∪ O*NET Related Occupations (boost 10%); rank by
 * boostedSimilarity × (1 + max(0, gain)), gain = target.typicalHumanShare − source.typicalHumanShare; top 8.
 * `relatedPairs` maps code → set of O*NET related codes.
 */
export function computeRelated(
  occs: readonly RelatedInput[],
  relatedPairs: Map<string, Set<string>>,
): Map<string, RelatedOccupation[]> {
  const dims = [...new Set(occs.flatMap((o) => [...o.importance.keys()]))].sort();
  const vecs = new Map<string, Float64Array>();
  for (const o of occs) {
    const v = centredVector(o.importance, dims);
    if (v) vecs.set(o.code, v);
  }
  const out = new Map<string, RelatedOccupation[]>();
  for (const src of occs) {
    const sv = vecs.get(src.code);
    if (!sv) {
      out.set(src.code, []);
      continue;
    }
    // Same Job Zone or one step up (data-sources.md §7 step 8). A step down is excluded: with the human-share
    // gain in the rank, it would fill an RN's list with nursing assistants at −$55k instead of realistic moves.
    const zoneOk = (t: RelatedInput) =>
      src.jobZone === null || t.jobZone === null || (t.jobZone >= src.jobZone && t.jobZone - src.jobZone <= RELATED.jobZoneSpan);
    const scored = occs
      .filter((t) => t.code !== src.code && vecs.has(t.code) && zoneOk(t))
      .map((t) => ({ t, sim: cosine(sv, vecs.get(t.code)!) }))
      .sort((a, b) => b.sim - a.sim || cmp(a.t.code, b.t.code));
    const rel = relatedPairs.get(src.code) ?? new Set<string>();
    const candidates = [...scored.slice(0, RELATED.candidates), ...scored.slice(RELATED.candidates).filter((x) => rel.has(x.t.code))];
    const ranked = candidates
      .map((x) => {
        const boosted = x.sim * (rel.has(x.t.code) ? 1 + RELATED.relatedBoost : 1);
        const gain = x.t.typicalHumanShare - src.typicalHumanShare;
        return { ...x, rank: boosted * (1 + Math.max(0, gain)) };
      })
      .sort((a, b) => b.rank - a.rank || cmp(a.t.code, b.t.code))
      .slice(0, RELATED.keep);
    out.set(
      src.code,
      ranked.map(({ t, sim }) => ({
        code: t.code,
        slug: t.slug,
        title: t.title,
        similarity: Math.round(sim * 1000) / 1000,
        typicalHumanShare: t.typicalHumanShare,
        wageDelta: t.medianAnnual !== null && src.medianAnnual !== null ? t.medianAnnual - src.medianAnnual : null,
        missingSkills: missingSkills(src, t),
      })),
    );
  }
  return out;
}

/** Skills and knowledge the target needs at least 0.75 more (importance), largest gap first, up to 5. */
export function missingSkills(src: RelatedInput, target: RelatedInput): string[] {
  const gaps: { name: string; gap: number }[] = [];
  for (const [id, imp] of target.importance) {
    const gap = imp - (src.importance.get(id) ?? 1);
    if (gap >= RELATED.missingSkillGap) gaps.push({ name: target.names.get(id) ?? id, gap });
  }
  gaps.sort((a, b) => b.gap - a.gap || cmp(a.name, b.name));
  return gaps.slice(0, RELATED.missingSkillsMax).map((g) => g.name);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
