import { RELATED } from '../constants';
import type { RelatedOccupation } from '../types';

export interface RelatedInput {
  code: string;
  slug: string;
  title: string;
  jobZone: number | null;
  /** O*NET Required Level of Education category (1..12) most respondents name; null when unknown. */
  education: number | null;
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

export type RelatedTier = 'Primary-Short' | 'Primary-Long';

/**
 * Neighbours of every occupation (01.1.4, reworked after the stage-01 review):
 * - candidates: same Job Zone or one step up, skill+knowledge cosine >= 0.86 (>= 0.75 for O*NET Related
 *   Occupations), a larger typical human share than the source (gain > 0);
 * - rank = (similarity + 0.08 Primary-Short / 0.05 Primary-Long + 0.04 same SOC major group)
 *          × (1 + 0.1 × min(1, gain / 0.5)) — the gain only breaks near-ties;
 * - when fewer than 3 have a positive gain, candidates about as safe (gain >= −0.05) fill up to 3; top 8.
 * `relatedPairs` maps code → O*NET related code → tier.
 */
export function computeRelated(
  occs: readonly RelatedInput[],
  relatedPairs: Map<string, Map<string, RelatedTier>>,
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
    const zoneOk = (t: RelatedInput) =>
      src.jobZone === null || t.jobZone === null || (t.jobZone >= src.jobZone && t.jobZone - src.jobZone <= RELATED.jobZoneSpan);
    const rel = relatedPairs.get(src.code) ?? new Map<string, RelatedTier>();
    // A neighbour needs at most two more education levels (bachelor's → master's is a move; → MD is not).
    const eduOk = (t: RelatedInput) => src.education === null || t.education === null || t.education - src.education <= RELATED.maxEducationStep;
    const scored = occs
      .filter((t) => t.code !== src.code && vecs.has(t.code) && zoneOk(t) && eduOk(t))
      .map((t) => {
        const sim = cosine(sv, vecs.get(t.code)!);
        const tier = rel.get(t.code);
        const gain = t.typicalHumanShare - src.typicalHumanShare;
        const bonus =
          (tier === 'Primary-Short' ? RELATED.bonusPrimaryShort : tier === 'Primary-Long' ? RELATED.bonusPrimaryLong : 0) +
          (t.code.slice(0, 2) === src.code.slice(0, 2) ? RELATED.bonusSameMajor : 0);
        const rank = (sim + bonus) * (1 + RELATED.gainTieBreak * Math.min(1, Math.max(0, gain) / 0.5));
        const sameMajor = t.code.slice(0, 2) === src.code.slice(0, 2);
        // O*NET-related at a lower bar; same SOC major group at the normal bar; other fields only when very close.
        const minSim = tier ? RELATED.minSimilarityRelated : sameMajor ? RELATED.minSimilarity : RELATED.minSimilarityOtherGroup;
        return { t, sim, gain, rank, minSim };
      })
      .filter((x) => x.sim >= x.minSim)
      .sort((a, b) => b.rank - a.rank || cmp(a.t.code, b.t.code));
    let chosen = scored.filter((x) => x.gain > 0).slice(0, RELATED.keep);
    if (chosen.length < RELATED.minNeighbours) {
      const equal = scored.filter((x) => x.gain <= 0 && x.gain >= -RELATED.equalGainTolerance).slice(0, RELATED.minNeighbours - chosen.length);
      chosen = [...chosen, ...equal].sort((a, b) => b.rank - a.rank || cmp(a.t.code, b.t.code));
    }
    out.set(
      src.code,
      chosen.map(({ t, sim }) => ({
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
