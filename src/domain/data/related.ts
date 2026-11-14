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

export type RelatedTier = 'Primary-Short' | 'Primary-Long' | 'Supplemental';

const TIER_BONUS: Record<RelatedTier, number> = {
  'Primary-Short': RELATED.bonusPrimaryShort,
  'Primary-Long': RELATED.bonusPrimaryLong,
  Supplemental: RELATED.bonusSupplemental,
};

/**
 * Neighbours of every occupation (data repair round). Candidates are O*NET's own Related Occupations (any tier,
 * skill+knowledge cosine >= 0.7) plus occupations with a very close skill profile (>= 0.86 in the same SOC major
 * group, >= 0.92 elsewhere). Hard limits: same Job Zone or one step up, at most two education levels more, and
 * not clearly less safe (typical human share at most 5 points lower).
 * Rank = similarity + O*NET tier bonus (0.15 / 0.1 / 0.05) + 0.02 same major group + up to 0.1 for a larger
 * human share + up to 0.05 for higher pay. Moves that pay clearly less (more than 5% below the source median)
 * are used only when nothing else qualifies. Top 8.
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
    // A neighbour needs at most two more education levels (bachelor's → master's is a move; → MD is not).
    const eduOk = (t: RelatedInput) => src.education === null || t.education === null || t.education - src.education <= RELATED.maxEducationStep;
    const rel = relatedPairs.get(src.code) ?? new Map<string, RelatedTier>();
    const scored = occs
      .filter((t) => t.code !== src.code && vecs.has(t.code) && zoneOk(t) && eduOk(t))
      .map((t) => {
        const sim = cosine(sv, vecs.get(t.code)!);
        const tier = rel.get(t.code);
        const sameMajor = t.code.slice(0, 2) === src.code.slice(0, 2);
        const minSim = tier ? RELATED.minSimilarityRelated : sameMajor ? RELATED.minSimilarity : RELATED.minSimilarityOtherGroup;
        const gain = t.typicalHumanShare - src.typicalHumanShare;
        const payRatio = t.medianAnnual !== null && src.medianAnnual ? t.medianAnnual / src.medianAnnual - 1 : null;
        const rank =
          sim +
          (tier ? TIER_BONUS[tier] : 0) +
          (sameMajor ? RELATED.bonusSameMajor : 0) +
          RELATED.gainTieBreak * Math.min(1, Math.max(0, gain) / 0.5) +
          RELATED.payBonus * Math.min(1, Math.max(0, payRatio ?? 0) / 0.3);
        return { t, sim, gain, payRatio, rank, minSim };
      })
      .filter((x) => x.sim >= x.minSim && x.gain >= -RELATED.equalGainTolerance)
      .sort((a, b) => b.rank - a.rank || cmp(a.t.code, b.t.code));
    const paysLess = (x: (typeof scored)[number]) => x.payRatio !== null && x.payRatio < -RELATED.maxPayDrop;
    let chosen = scored.filter((x) => !paysLess(x)).slice(0, RELATED.keep);
    // Only when nothing pays at least about the same do lower-paid moves appear at all.
    if (chosen.length === 0) chosen = scored.filter(paysLess).slice(0, RELATED.minNeighbours);
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

/**
 * Skills and knowledge that matter in the target (importance >= 3) and that the source rates at least 0.75
 * lower, largest gap first, up to 5. Elements the source does not rate are not guessed.
 */
export function missingSkills(src: RelatedInput, target: RelatedInput): string[] {
  const gaps: { name: string; gap: number }[] = [];
  for (const [id, imp] of target.importance) {
    if (imp < RELATED.missingSkillMinImportance || !src.importance.has(id)) continue;
    const gap = imp - src.importance.get(id)!;
    if (gap >= RELATED.missingSkillGap) gaps.push({ name: target.names.get(id) ?? id, gap });
  }
  gaps.sort((a, b) => b.gap - a.gap || cmp(a.name, b.name));
  // Skill and knowledge lists share a few names (Mathematics): list each name once.
  return [...new Set(gaps.map((g) => g.name))].slice(0, RELATED.missingSkillsMax);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
