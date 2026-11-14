import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultShares } from '@/domain/shares';
import type { Category, Locale, RepType } from '@/domain/types';

/** What the bank holds (03.3) and how the task of each entry is chosen. Pure: no model, no network. */

export const TOP_N = 60;

export const DEMO_TITLES = [
  'Registered Nurses',
  'Accountants and Auditors',
  'Electricians',
  'Customer Service Representatives',
  'Middle School Teachers',
  'Paralegals',
  'Human Resources Specialists',
  'Marketing Managers',
  'Dispatchers',
  'Claims Adjusters',
  'Software Developers',
  'Licensed Practical',
] as const;

/** Nurse, accountant, electrician: also the landing minis and the ru/kk slips. */
export const LOCALIZED_TITLES = ['Registered Nurses', 'Accountants and Auditors', 'Electricians'] as const;

/** The same task-choice rule as the live path (03.1.4): the preferred categories first, then the nearest ones. */
const GROUPS: Record<RepType, Category[][]> = {
  slip: [['ai_does', 'ai_speeds'], ['no_data'], ['human_edge']],
  delegate: [['ai_does', 'ai_speeds'], ['no_data'], ['human_edge']],
  edge: [['human_edge'], ['no_data'], ['ai_speeds', 'ai_does']],
};

interface IndexRow {
  code: string;
  title: string;
  employment: number | null;
}
interface BundleTask {
  id: string;
  text: string;
  short?: string;
  evidence: { category: Category };
}
export interface Bundle {
  code: string;
  title: string;
  tasks: BundleTask[];
}

export interface Job {
  /** Stable file key: <code>/<type>-<n>. */
  key: string;
  type: RepType;
  n: number;
  code: string;
  occupation: string;
  locale: Locale;
  difficulty: 1 | 2 | 3;
  taskId: string;
  task: string;
  taskShort: string;
  seed: string;
}

export function loadBundle(root: string, code: string): Bundle {
  return JSON.parse(readFileSync(path.join(root, 'public', 'data', 'occ', `${code}.json`), 'utf8')) as Bundle;
}

export function loadIndex(root: string): IndexRow[] {
  return JSON.parse(readFileSync(path.join(root, 'data', 'build', 'index.json'), 'utf8')) as IndexRow[];
}

/** Top `n` occupations by BLS employment; O*NET detail codes that share one SOC row count once. */
export function topCodes(index: IndexRow[], n: number): IndexRow[] {
  const seen = new Set<string>();
  const out: IndexRow[] = [];
  for (const row of [...index].filter((r) => r.employment).sort((a, b) => (b.employment ?? 0) - (a.employment ?? 0) || a.code.localeCompare(b.code))) {
    const soc = row.code.slice(0, 7);
    if (seen.has(soc)) continue;
    seen.add(soc);
    out.push(row);
    if (out.length === n) break;
  }
  return out;
}

/**
 * Tasks of the occupation's default week that have a short label, best first for this rep type: the
 * preferred category group by share, then each nearer group, then whatever remains.
 */
export function candidates(bundle: Bundle, type: RepType): BundleTask[] {
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const week = defaultShares({ tasks: bundle.tasks as never })
    .filter((s) => byId.get(s.taskId)?.short)
    .sort((a, b) => b.share - a.share);
  const out: BundleTask[] = [];
  const add = (id: string) => {
    const t = byId.get(id)!;
    if (!out.includes(t)) out.push(t);
  };
  for (const cats of GROUPS[type]) for (const s of week) if (cats.includes(byId.get(s.taskId)!.evidence.category)) add(s.taskId);
  for (const s of week) add(s.taskId);
  if (!out.length) {
    // nothing with a label in the week: the largest task of the occupation
    const biggest = bundle.tasks.find((t) => t.short) ?? bundle.tasks[0];
    if (biggest) out.push(biggest);
  }
  return out;
}

/** Entries of one occupation, tasks spread so that one occupation's entries rarely repeat a task. */
export function jobsFor(bundle: Bundle, opts: { slips: number; delegate: boolean; edge: boolean; extraLocales: boolean }): Job[] {
  const used = new Set<string>();
  const pick = (type: RepType): BundleTask => {
    const list = candidates(bundle, type);
    const t = list.find((c) => !used.has(c.id)) ?? list[0];
    used.add(t.id);
    return t;
  };
  const make = (type: RepType, n: number, locale: Locale, difficulty: 1 | 2 | 3, task: BundleTask): Job => ({
    key: `${bundle.code}/${type}-${n}`,
    type,
    n,
    code: bundle.code,
    occupation: bundle.title,
    locale,
    difficulty,
    taskId: task.id,
    task: task.text,
    taskShort: task.short ?? '',
    seed: `bank:${bundle.code}:${type}:${n}:${locale}`,
  });
  const jobs: Job[] = [];
  // first slip: difficulty 1 (two mistakes), it is also what the free trial serves
  const first = pick('slip');
  jobs.push(make('slip', 1, 'en', 1, first));
  if (opts.slips > 1) jobs.push(make('slip', 2, 'en', 2, pick('slip')));
  if (opts.delegate) jobs.push(make('delegate', 1, 'en', 2, pick('delegate')));
  if (opts.edge) jobs.push(make('edge', 1, 'en', 2, pick('edge')));
  if (opts.extraLocales) {
    jobs.push(make('slip', 3, 'ru', 1, first));
    jobs.push(make('slip', 4, 'kk', 1, first));
  }
  return jobs;
}

export function buildPlan(root: string): { jobs: Job[]; landing: { name: string; code: string }[]; notes: string[] } {
  const index = loadIndex(root);
  const top = topCodes(index, TOP_N);
  const notes: string[] = [];
  const demo = DEMO_TITLES.map((prefix) => {
    const row = index.find((r) => r.title.startsWith(prefix));
    if (!row) throw new Error(`demo occupation "${prefix}" is not in index.json`);
    return row;
  });
  const demoCodes = new Set(demo.map((d) => d.code));
  const localized = new Set(LOCALIZED_TITLES.map((p) => index.find((r) => r.title.startsWith(p))!.code));
  const codes = [...top.map((r) => r.code)];
  for (const d of demo) if (!codes.includes(d.code)) {
    codes.push(d.code);
    notes.push(`${d.title} is outside the top ${TOP_N} by employment; it is added because it is a demo occupation.`);
  }
  const jobs: Job[] = [];
  for (const code of codes) {
    const bundle = loadBundle(root, code);
    const isDemo = demoCodes.has(code);
    jobs.push(...jobsFor(bundle, { slips: isDemo ? 2 : 1, delegate: isDemo, edge: isDemo, extraLocales: localized.has(code) }));
  }
  const landing = [
    { name: 'nurse', code: index.find((r) => r.title.startsWith('Registered Nurses'))!.code },
    { name: 'accountant', code: index.find((r) => r.title.startsWith('Accountants and Auditors'))!.code },
    { name: 'electrician', code: index.find((r) => r.title.startsWith('Electricians'))!.code },
  ];
  return { jobs, landing, notes };
}
