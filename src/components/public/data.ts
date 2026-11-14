import meta from '../../../data/build/meta.json';
import { getOccupationIndex, loadBundle } from '@/server/xray/data';
import type { OccupationBundle, OccupationIndexEntry } from '@/domain/types';

/**
 * Data the public pages read. meta.json is imported, so /method shows the numbers of the build it
 * ships with; occupation bundles and the index are read from the same files the API uses.
 */

export type BuildMeta = typeof meta & {
  /** Occupation-level agreement with other published measures (Spearman); present once the pipeline writes it. */
  validation?: { id: string; label: string; rho: number; n: number }[];
};

export function getMeta(): BuildMeta {
  return meta as BuildMeta;
}

/**
 * Agreement of our occupation-level indicator with Anthropic's observed exposure and Microsoft's AI
 * applicability score, measured in the data probe (research/data-sources.md §3.2). meta.json takes
 * precedence when the pipeline starts writing `validation`.
 */
const PROBE_VALIDATION = [
  { id: 'anthropic', label: 'Anthropic observed_exposure', rho: 0.72, n: 748 },
  { id: 'microsoft', label: 'Microsoft ai_applicability_score', rho: 0.76, n: 773 },
];

export function getValidation() {
  return getMeta().validation ?? PROBE_VALIDATION;
}

/** All occupations with tasks, by rank (1 = most people employed, BLS May 2025). */
export async function getOccupations(): Promise<OccupationIndexEntry[]> {
  const index = await getOccupationIndex();
  return [...index.values()].sort((a, b) => a.rank - b.rank);
}

export async function getOccupationBySlug(slug: string): Promise<OccupationIndexEntry | null> {
  const list = await getOccupations();
  return list.find((o) => o.slug === slug) ?? null;
}

export async function getBundle(code: string): Promise<OccupationBundle | null> {
  return loadBundle(code);
}

/** Number of job pages rendered at build time; the rest render on first visit and are cached. */
export const STATIC_JOB_PAGES = 150;

export function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  try {
    return new URL(raw);
  } catch {
    return new URL('http://localhost:3000');
  }
}

/** The five datasets with their versions and licences, in the order the method explains them. */
export function sourceList() {
  const m = getMeta();
  const a = m.attribution;
  return [
    { id: 'onet', name: 'O*NET® Database', version: `${m.dataVersion.onet}, ${m.onetRelease}`, license: a.onet.license, url: a.onet.url, attribution: a.onet.text },
    { id: 'aei', name: 'Anthropic Economic Index', version: `release ${m.dataVersion.aei}`, license: a.aei.license, url: a.aei.url, attribution: a.aei.text },
    { id: 'gpts', name: 'GPTs are GPTs', version: 'Eloundou et al., Science 2024', license: a.gpts.license, url: a.gpts.url, attribution: a.gpts.text },
    { id: 'ms', name: 'Working with AI', version: m.dataVersion.ms, license: a.ms.license, url: a.ms.url, attribution: a.ms.text },
    { id: 'bls', name: 'BLS Occupational Employment and Wage Statistics', version: m.dataVersion.bls, license: a.bls.license, url: a.bls.url, attribution: a.bls.text },
  ];
}
