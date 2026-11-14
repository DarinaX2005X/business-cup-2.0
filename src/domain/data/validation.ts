/** Average ranks (1-based), ties share the mean rank. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array<number>(values.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const r = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m].i] = r;
    k = j + 1;
  }
  return out;
}

/** Spearman rank correlation (Pearson on average ranks); NaN when fewer than 3 pairs or no variance. */
export function spearman(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n !== y.length || n < 3) return NaN;
  const rx = ranks(x);
  const ry = ranks(y);
  const mean = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mean;
    const dy = ry[i] - mean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export interface ValidationRow {
  id: 'anthropic' | 'microsoft';
  label: string;
  rho: number;
  n: number;
}

/**
 * Occupation-level check of our indicator against a published measure keyed by 6-digit SOC. Our value per
 * O*NET occupation is averaged over the O*NET codes that share a SOC code before ranking.
 */
export function validateAgainst(
  ours: ReadonlyMap<string, number>,
  theirs: readonly [string, number][],
  id: ValidationRow['id'],
  label: string,
): ValidationRow {
  const bySoc = new Map<string, { s: number; n: number }>();
  for (const [code, v] of ours) {
    const soc = code.slice(0, 7);
    const cur = bySoc.get(soc) ?? { s: 0, n: 0 };
    cur.s += v;
    cur.n += 1;
    bySoc.set(soc, cur);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [soc, v] of [...theirs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const o = bySoc.get(soc);
    if (!o || !Number.isFinite(v)) continue;
    xs.push(o.s / o.n);
    ys.push(v);
  }
  return { id, label, rho: Math.round(spearman(xs, ys) * 1000) / 1000, n: xs.length };
}
