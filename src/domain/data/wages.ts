import type { OccupationBundle } from '../types';
import type { RawOewsRow } from './raw';

/**
 * O*NET-SOC → OEWS May 2025 (research/data-sources.md §4, §7):
 * soc6 = code[:7] against O_GROUP = detailed; otherwise the aggregate xx-xxx0 / xx-xx00 (detailed or broad);
 * otherwise the manual crosswalk below. Flags: `*` not available, `#` above the top-code, `**` no employment;
 * hourly-only occupations get annual = hourly median × 2080 (BLS convention), marked hourly_x2080.
 */
export const MANUAL_OEWS: Record<string, string> = {
  // Codes O*NET splits further than OEWS publishes; filled from the first build's unmatched list.
  '21-1011': '21-1018', // Substance abuse and behavioral disorder counselors
  '21-1014': '21-1018', // Mental health counselors
  '51-2022': '51-2028', // Electrical and electronic equipment assemblers
  '51-2023': '51-2028', // Electromechanical equipment assemblers
  '51-2092': '51-2090', // Team assemblers → miscellaneous assemblers and fabricators
  '53-1042': '53-1047', // First-line supervisors of helpers, laborers, material movers
  '53-1043': '53-1047',
  '53-1044': '53-1047',
  '25-9042': '25-9045', // Teaching assistants, except postsecondary
  '25-9043': '25-9045',
  '25-9049': '25-9045',
};

export type Wage = OccupationBundle['wage'];

const NO_WAGE: Wage = { medianAnnual: null, employment: null, sharedWith: 0, soc: null, note: null, source: 'BLS OEWS May 2025' };

function toNum(v: string): number | null {
  const s = v.replace(/,/g, '').trim();
  if (!s || s === '*' || s === '**' || s === '#' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface WageMapping {
  wages: Map<string, Wage>;
  unmatched: string[]; // O*NET codes without any OEWS row
  matched: { detailed: number; aggregate: number; manual: number };
}

export function mapWages(codes: readonly string[], oews: readonly RawOewsRow[] | null): WageMapping {
  const wages = new Map<string, Wage>();
  if (!oews) {
    for (const c of codes) wages.set(c, NO_WAGE);
    return { wages, unmatched: [...codes], matched: { detailed: 0, aggregate: 0, manual: 0 } };
  }
  const detailed = new Map<string, RawOewsRow>();
  const broad = new Map<string, RawOewsRow>();
  for (const r of oews) {
    if (r.group === 'detailed') detailed.set(r.occ, r);
    else if (r.group === 'broad') broad.set(r.occ, r);
  }
  const lookup = (soc: string) => detailed.get(soc) ?? broad.get(soc);
  const target = new Map<string, { row: RawOewsRow; how: 'detailed' | 'aggregate' | 'manual' }>();
  const unmatched: string[] = [];
  const matched = { detailed: 0, aggregate: 0, manual: 0 };
  for (const code of codes) {
    const soc6 = code.slice(0, 7);
    let hit: { row: RawOewsRow; how: 'detailed' | 'aggregate' | 'manual' } | null = null;
    const d = detailed.get(soc6);
    if (d) hit = { row: d, how: 'detailed' };
    if (!hit && MANUAL_OEWS[soc6] && lookup(MANUAL_OEWS[soc6])) hit = { row: lookup(MANUAL_OEWS[soc6])!, how: 'manual' };
    if (!hit) {
      for (const agg of [soc6.slice(0, 6) + '0', soc6.slice(0, 5) + '00']) {
        const r = lookup(agg);
        if (r) {
          hit = { row: r, how: 'aggregate' };
          break;
        }
      }
    }
    if (!hit) {
      unmatched.push(code);
      continue;
    }
    matched[hit.how]++;
    target.set(code, hit);
  }
  const sharedCount = new Map<string, number>();
  for (const { row } of target.values()) sharedCount.set(row.occ, (sharedCount.get(row.occ) ?? 0) + 1);
  for (const code of codes) {
    const hit = target.get(code);
    if (!hit) {
      wages.set(code, NO_WAGE);
      continue;
    }
    const { row, how } = hit;
    let medianAnnual = toNum(row.aMedian);
    let note: Wage['note'] = how === 'detailed' ? null : 'aggregate';
    if (row.aMedian.trim() === '#') note = 'top_coded';
    else if (medianAnnual === null) {
      const hourly = toNum(row.hMedian);
      if (hourly !== null) {
        medianAnnual = Math.round(hourly * 2080);
        note = 'hourly_x2080';
      }
    }
    wages.set(code, {
      medianAnnual,
      employment: toNum(row.totEmp),
      sharedWith: sharedCount.get(row.occ) ?? 1,
      soc: row.occ,
      note,
      source: 'BLS OEWS May 2025',
    });
  }
  return { wages, unmatched, matched };
}
