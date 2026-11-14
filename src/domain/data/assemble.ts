// Pure data build: RawSources (+ hand-written dictionaries) → published files. No I/O, deterministic.
import {
  AEI_PCT_FLOOR,
  AT_STAKE_WEIGHTS,
  CATEGORY_THRESHOLDS,
  DEFAULT_SHARE_MAX,
  DEFAULT_SHARE_MIN,
  DEFAULT_WEEK_TASKS,
  FREQ_PER_YEAR,
  HISTORY_MIN_PERIODS,
  PEOPLE_GWAS,
  RELATED,
  THEORY_WEIGHT,
  WORK_GATE,
} from '../constants';
import { buildEvidence, theoryFromLabels } from '../evidence';
import { buildSearchIndex, type SearchIndexFile } from '../search';
import { defaultShares } from '../shares';
import { normTaskText, shortFromTask, slugify } from '../text';
import type {
  Category,
  DataVersion,
  OccTask,
  OccupationBundle,
  OccupationIndexEntry,
  RelatedOccupation,
  TaskEvidence,
  TitleIndexEntry,
} from '../types';
import type { RawAeiTask, RawSources } from './raw';
import { computeRelated, type RelatedInput, type RelatedTier } from './related';
import { mapWages } from './wages';
import { validateAgainst, type ValidationRow } from './validation';

export interface AliasEntry {
  alias: string;
  code: string;
  note: string;
  lang?: 'ru' | 'kk';
}

export interface TranslatedTitle {
  code: string;
  title: string;
}

export interface AssembleInput {
  sources: RawSources;
  aliases: AliasEntry[];
  aliasesI18n: AliasEntry[];
  /** Model translations from data/build/titles.<lang>.json, when the script has been run. */
  translations: { ru: TranslatedTitle[]; kk: TranslatedTitle[] };
  /** Reviewed main Russian and Kazakh title per occupation (data/titles-primary.json). */
  titlesPrimary?: Record<string, { ru: string; kk: string }>;
  /** Model name recorded in titles.<lang>.json. */
  translationsModel?: string;
  /** Model-written short task labels from data/build/short-labels.en.json (taskId → label), when present. */
  shortLabels?: Record<string, string>;
}

export interface BuildOutput {
  bundles: OccupationBundle[];
  titles: TitleIndexEntry[];
  index: OccupationIndexEntry[];
  searchIndex: SearchIndexFile;
  meta: BuildMeta;
  /** data/build/titles.<lang>.json: the first title per code is the one the UI shows. */
  localTitles: { ru: TranslatedTitle[]; kk: TranslatedTitle[] };
  translationsModel: string;
  /** code → full neighbour list (server-only, data/build/related.json). */
  related: Record<string, RelatedOccupation[]>;
}

/** Neighbours the public bundle carries: what a Free user sees. */
export const PUBLIC_RELATED = 1;

export const DATA_VERSION: DataVersion = {
  onet: '31.0',
  aei: '2026-06-26',
  gpts: 'GPTs-are-GPTs full_labelset.tsv (2024)',
  ms: 'Working with AI v1.1',
  bls: 'May 2025',
};

const KIND_ORDER: Record<TitleIndexEntry['k'], number> = { alias: 0, primary: 1, reported: 2, alt: 3 };

export function assemble(input: AssembleInput): BuildOutput {
  const { sources: src } = input;
  const titleOf = new Map(src.occupations.map((o) => [o.code, o]));

  // ---- occupations with tasks (the 93 without tasks are never offered as a match)
  const tasksByCode = new Map<string, RawSources['tasks']>();
  for (const t of src.tasks) {
    if (!tasksByCode.has(t.code)) tasksByCode.set(t.code, []);
    tasksByCode.get(t.code)!.push(t);
  }
  const codes = [...tasksByCode.keys()].sort();

  // ---- ratings: IM → importance, RT → relevance, FT → mean category of the 1–7 distribution
  const im = new Map<string, number>();
  const rt = new Map<string, number>();
  const ft = new Map<string, { cw: number; w: number }>();
  for (const [code, id, scale, cat, value] of src.ratings) {
    const k = `${code}|${id}`;
    if (scale === 'IM') im.set(k, value);
    else if (scale === 'RT') rt.set(k, value);
    else if (scale === 'FT') {
      const f = ft.get(k) ?? { cw: 0, w: 0 };
      f.cw += Number(cat) * (value / 100);
      f.w += value / 100;
      ft.set(k, f);
    }
  }

  // ---- text normalisation, shared by every text join
  const normOfTask = new Map<string, string>(); // taskId → norm
  const idsByNorm = new Map<string, string[]>();
  for (const t of src.tasks) {
    const n = normTaskText(t.text);
    normOfTask.set(t.id, n);
    if (!idsByNorm.has(n)) idsByNorm.set(n, []);
    idsByNorm.get(n)!.push(t.id);
  }
  const onetIds = new Set(src.tasks.map((t) => t.id));

  // ---- theory: GPTs-are-GPTs by Task ID (same text) → by normalised text → by Task ID (text edited)
  const gptById = new Map(src.gpts.map((g) => [g.taskId, g]));
  const gptByNorm = new Map<string, RawSources['gpts'][number]>();
  for (const g of src.gpts) {
    const n = normTaskText(g.text);
    if (!gptByNorm.has(n)) gptByNorm.set(n, g);
  }
  type Label = 'E0' | 'E1' | 'E2';
  const theoryOf = new Map<string, { human: Label | null; gpt4: Label | null; theory: number; source: 'human' | 'gpt4' | 'human+gpt4'; how: 'id' | 'text' | 'id_text_changed' }>();
  for (const t of src.tasks) {
    const n = normOfTask.get(t.id)!;
    const byId = gptById.get(t.id);
    let g: RawSources['gpts'][number] | undefined;
    let how: 'id' | 'text' | 'id_text_changed' = 'id';
    if (byId && normTaskText(byId.text) === n) g = byId;
    else if (gptByNorm.has(n)) {
      g = gptByNorm.get(n);
      how = 'text';
    } else if (byId) {
      g = byId;
      how = 'id_text_changed';
    }
    if (!g) continue;
    const th = theoryFromLabels(g.human, g.gpt4);
    if (th) theoryOf.set(t.id, { human: g.human, gpt4: g.gpt4, theory: th.theory, source: th.source, how });
  }
  // DWA imputation: mean theory of labelled tasks sharing a DWA, then mean over the task's DWAs
  const dwasOf = new Map<string, string[]>();
  for (const [taskId, dwa] of src.taskDwas) {
    if (!dwasOf.has(taskId)) dwasOf.set(taskId, []);
    const list = dwasOf.get(taskId)!;
    if (!list.includes(dwa)) list.push(dwa);
  }
  const dwaSum = new Map<string, { s: number; n: number }>();
  for (const [taskId, dwa] of src.taskDwas) {
    const th = theoryOf.get(taskId);
    if (!th) continue;
    const d = dwaSum.get(dwa) ?? { s: 0, n: 0 };
    d.s += th.theory;
    d.n += 1;
    dwaSum.set(dwa, d);
  }
  const estimatedTheory = (taskId: string): number | null => {
    const vals = (dwasOf.get(taskId) ?? []).map((d) => dwaSum.get(d)).filter((d): d is { s: number; n: number } => !!d && d.n > 0);
    if (!vals.length) return null;
    return vals.reduce((a, d) => a + d.s / d.n, 0) / vals.length;
  };

  // ---- AEI 2026-06-26: latest month per task and source, joined by Task ID, copied to identical texts
  type Latest = Omit<RawAeiTask, 'text'>;
  const aeiByNorm: Record<'claude_ai' | '1p_api', Map<string, Latest>> = { claude_ai: new Map(), '1p_api': new Map() };
  const latestPeriodShare = new Map<string, Map<string, number>>(); // norm → period → claude_ai share (history)
  for (const source of ['claude_ai', '1p_api'] as const) {
    const latest = new Map<string, RawAeiTask>();
    for (const r of src.aei[source]) {
      if (!onetIds.has(r.taskId)) continue;
      const prev = latest.get(r.taskId);
      if (!prev || r.period > prev.period) latest.set(r.taskId, r);
      if (source === 'claude_ai' && r.pct !== null) {
        const n = normOfTask.get(r.taskId)!;
        if (!latestPeriodShare.has(n)) latestPeriodShare.set(n, new Map());
        latestPeriodShare.get(n)!.set(r.period.slice(0, 7), r.pct / 100);
      }
    }
    for (const id of [...latest.keys()].sort((a, b) => Number(a) - Number(b))) {
      const n = normOfTask.get(id)!;
      if (!aeiByNorm[source].has(n)) aeiByNorm[source].set(n, latest.get(id)!);
    }
  }

  // ---- older releases (text-keyed): everObserved and Claude.ai history
  const everNorms = new Set<string>([...aeiByNorm.claude_ai.keys(), ...aeiByNorm['1p_api'].keys()]);
  const oldShare = new Map<string, Map<string, number>>(); // norm → period → share (claude_ai)
  const oldMatch: Record<string, { rows: number; matched: number }> = {};
  for (const rel of src.aeiOld) {
    let matched = 0;
    for (const [text, pct] of rel.rows) {
      const n = normTaskText(text);
      if (!idsByNorm.has(n)) continue;
      matched++;
      everNorms.add(n);
      if (rel.source === 'claude_ai') {
        if (!oldShare.has(n)) oldShare.set(n, new Map());
        const m = oldShare.get(n)!;
        m.set(rel.period, Math.max(m.get(rel.period) ?? 0, pct / 100));
      }
    }
    oldMatch[`${rel.release} ${rel.source}`] = { rows: rel.rows.length, matched };
  }

  const penByNorm = new Map<string, number>();
  for (const [text, v] of src.penetration) {
    const n = normTaskText(text);
    penByNorm.set(n, Math.max(penByNorm.get(n) ?? -Infinity, v));
  }
  const physicalById = new Map(src.physical);
  const gwaOfDwa = new Map(src.dwaGwa ?? []);
  const dwaName = new Map(src.dwaNames ?? []);

  // ---- evidence per task
  const evidenceOf = (taskId: string): TaskEvidence => {
    const n = normOfTask.get(taskId)!;
    const th = theoryOf.get(taskId);
    const est = th ? null : estimatedTheory(taskId);
    const ca = aeiByNorm.claude_ai.get(n);
    const api = aeiByNorm['1p_api'].get(n);
    let num = 0;
    let den = 0;
    for (const r of [ca, api]) {
      if (!r || r.automation === null || r.augmentation === null) continue;
      const tot = r.automation + r.augmentation;
      if (!(tot > 0)) continue;
      const p = Math.max(r.pct ?? 0, AEI_PCT_FLOOR);
      num += p * (r.automation / tot);
      den += p;
    }
    const published = (ca?.pct ?? null) !== null || (api?.pct ?? null) !== null;
    const works = [ca?.work, api?.work].filter((w): w is number => w !== null && w !== undefined);
    const workMax = works.length ? Math.max(...works) / 100 : null;
    const observed = published && (workMax ?? 0) >= WORK_GATE;
    const shareSrc = ca?.pct != null ? 'claude_ai' : api?.pct != null ? '1p_api' : null;
    const share = shareSrc === 'claude_ai' ? ca!.pct! / 100 : shareSrc === '1p_api' ? api!.pct! / 100 : null;

    const periods = new Map<string, number>([...(oldShare.get(n) ?? new Map()), ...(latestPeriodShare.get(n) ?? new Map())]);
    const history =
      periods.size >= HISTORY_MIN_PERIODS
        ? [...periods.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([release, s]) => ({ release, share: round(s, 6) }))
        : null;

    const autoOf = (r: typeof ca) => {
      if (!r || r.automation === null || r.augmentation === null || !(r.automation + r.augmentation > 0)) return null;
      return round(r.automation / (r.automation + r.augmentation), 4);
    };
    const dwas = dwasOf.get(taskId) ?? [];
    const people = dwas.filter((d) => PEOPLE_GWAS[gwaOfDwa.get(d) ?? ''] !== undefined).length;
    return buildEvidence({
      theoryLabel: th ? th.human ?? th.gpt4 : null,
      gpt4Label: th?.gpt4 ?? null,
      theorySource: th ? th.source : est !== null ? 'estimated' : null,
      theory: th ? th.theory : est,
      observed,
      everObserved: everNorms.has(n),
      aeiShare: share === null ? null : round(share, 6),
      aeiSource: shareSrc,
      aeiAutomation: den > 0 ? round(num / den, 4) : null,
      aeiWorkShare: workMax === null ? null : round(workMax, 4),
      penetration: penByNorm.has(n) ? round(penByNorm.get(n)!, 4) : null,
      history,
      physical: physicalById.has(taskId) ? physicalById.get(taskId)! : null,
      aeiClaudeShare: ca?.pct != null ? round(ca.pct / 100, 6) : null,
      aeiApiShare: api?.pct != null ? round(api.pct / 100, 6) : null,
      aeiClaudeAutomation: autoOf(ca),
      aeiApiAutomation: autoOf(api),
      aeiClaudeWorkShare: ca?.work != null ? round(ca.work / 100, 4) : null,
      aeiApiWorkShare: api?.work != null ? round(api.work / 100, 4) : null,
      peopleWork: dwas.length > 0 && people / dwas.length >= CATEGORY_THRESHOLDS.peopleWorkShare,
    });
  };

  // ---- skills and knowledge
  const skillsByCode = groupElements(src.skills);
  const knowledgeByCode = groupElements(src.knowledge);
  const zoneByCode = new Map(src.jobZones);
  // Typical required education: the RL category most respondents name (ties → the lower category).
  const eduBest = new Map<string, [number, number]>();
  for (const [code, cat, v] of src.education ?? []) {
    const prev = eduBest.get(code);
    if (!prev || v > prev[1] || (v === prev[1] && cat < prev[0])) eduBest.set(code, [cat, v]);
  }

  // ---- titles per occupation (for slugs, ranking fallback and search)
  const titleCount = new Map<string, number>();
  for (const t of [...src.jobTitles, ...src.reportedTitles]) titleCount.set(t.code, (titleCount.get(t.code) ?? 0) + 1);

  // ---- wages
  const wageMap = mapWages(codes, src.oews);

  // ---- slugs (unique)
  const slugOf = new Map<string, string>();
  const usedSlugs = new Set<string>();
  for (const code of codes) {
    let s = slugify(titleOf.get(code)?.title ?? code);
    if (usedSlugs.has(s)) s = `${s}-${code.replace(/\./g, '-')}`;
    usedSlugs.add(s);
    slugOf.set(code, s);
  }

  // ---- bundles without related; atStake = typical week share AI does or speeds up (validation)
  const atStake = new Map<string, number>();
  const bundles: OccupationBundle[] = codes.map((code) => {
    const occ = titleOf.get(code)!;
    const tasks: OccTask[] = tasksByCode
      .get(code)!
      .map((t) => {
        const k = `${code}|${t.id}`;
        const f = ft.get(k);
        return {
          id: t.id,
          text: t.text,
          importance: im.has(k) ? round(im.get(k)!, 2) : null,
          relevance: rt.has(k) ? round(rt.get(k)!, 1) : null,
          frequency: f && f.w > 0 ? round(f.cw / f.w, 2) : null,
          core: t.type === 'Core',
          dwaIds: [...(dwasOf.get(t.id) ?? [])].sort(),
          short: input.shortLabels?.[t.id] ?? shortFromTask(t.text, (dwasOf.get(t.id) ?? []).map((d) => dwaName.get(d) ?? '').filter(Boolean)),
          evidence: evidenceOf(t.id),
        };
      })
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || Number(b.core) - Number(a.core) || Number(a.id) - Number(b.id));
    const shares = defaultShares({ tasks });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const human = shares.filter((s) => byId.get(s.taskId)!.evidence.category === 'human_edge').reduce((a, s) => a + s.share, 0);
    atStake.set(code, shares.reduce((a, s) => a + s.share * AT_STAKE_WEIGHTS[byId.get(s.taskId)!.evidence.category], 0) / 100);
    return {
      code,
      slug: slugOf.get(code)!,
      title: occ.title,
      description: occ.description,
      jobZone: zoneByCode.get(code) ?? null,
      wage: wageMap.wages.get(code)!,
      tasks,
      skills: topElements(skillsByCode.get(code), 10),
      knowledge: topElements(knowledgeByCode.get(code), 10),
      typicalHumanShare: human / 100,
      related: [],
      dataVersion: DATA_VERSION,
    };
  });

  // ---- neighbours
  const relatedPairs = new Map<string, Map<string, RelatedTier>>();
  for (const r of src.related) {
    if (r.tier !== 'Primary-Short' && r.tier !== 'Primary-Long' && r.tier !== 'Supplemental') continue;
    if (!relatedPairs.has(r.code)) relatedPairs.set(r.code, new Map());
    relatedPairs.get(r.code)!.set(r.related, r.tier);
  }
  const relInputs: RelatedInput[] = bundles.map((b) => {
    const importance = new Map<string, number>();
    const names = new Map<string, string>();
    for (const [id, name, v] of [...(skillsByCode.get(b.code) ?? []), ...(knowledgeByCode.get(b.code) ?? [])]) {
      importance.set(id, v);
      names.set(id, name);
    }
    return { code: b.code, slug: b.slug, title: b.title, jobZone: b.jobZone, education: eduBest.get(b.code)?.[0] ?? null, typicalHumanShare: b.typicalHumanShare, medianAnnual: b.wage.medianAnnual, importance, names };
  });
  const related = computeRelated(relInputs, relatedPairs);
  // The full list is a Pro feature: the public bundle carries only what Free shows (the first neighbour) and
  // the count; the rest goes to data/build/related.json, which only the server reads.
  const relatedFull: Record<string, RelatedOccupation[]> = {};
  for (const b of bundles) {
    const list = related.get(b.code) ?? [];
    relatedFull[b.code] = list;
    b.related = list.slice(0, PUBLIC_RELATED);
    b.relatedCount = list.length;
  }

  // ---- popularity ranking: BLS employment; a shared OEWS row counts in full for the base .00 occupation
  // and is split evenly among its specialties (.01, .02 …); without BLS, the number of O*NET titles.
  const rankBasis = src.oews ? 'bls_employment' : 'title_count';
  const popularityKey = (b: OccupationBundle) =>
    src.oews
      ? (b.wage.employment ?? 0) / (b.code.endsWith('.00') ? 1 : Math.max(1, b.wage.sharedWith))
      : titleCount.get(b.code) ?? 0;
  const byPopularity = [...bundles].sort(
    (a, b) => popularityKey(b) - popularityKey(a) || (titleCount.get(b.code) ?? 0) - (titleCount.get(a.code) ?? 0) || cmp(a.code, b.code),
  );
  const rankOf = new Map(byPopularity.map((b, i) => [b.code, i + 1]));
  const popularity: Record<string, number> = {};
  for (const b of bundles) popularity[b.code] = round(1 - (rankOf.get(b.code)! - 1) / bundles.length, 4);

  const index: OccupationIndexEntry[] = bundles.map((b) => ({
    code: b.code,
    slug: b.slug,
    title: b.title,
    jobZone: b.jobZone,
    taskCount: b.tasks.length,
    typicalHumanShare: b.typicalHumanShare,
    employment: b.wage.employment,
    rank: rankOf.get(b.code)!,
  }));

  // ---- title index
  const codeSet = new Set(codes);
  const aliasErrors = [...input.aliases, ...input.aliasesI18n].filter((a) => !codeSet.has(a.code)).map((a) => `${a.alias} → ${a.code}`);
  if (aliasErrors.length) throw new Error(`aliases point to occupations without tasks or unknown codes: ${aliasErrors.join(', ')}`);
  const raw: TitleIndexEntry[] = [];
  for (const code of codes) raw.push({ t: titleOf.get(code)!.title, c: code, k: 'primary' });
  for (const t of src.reportedTitles) if (codeSet.has(t.code)) raw.push({ t: t.title, c: t.code, k: 'reported' });
  for (const t of src.jobTitles) {
    if (!codeSet.has(t.code)) continue;
    raw.push({ t: t.title, c: t.code, k: 'alt' });
    if (t.short) raw.push({ t: t.short, c: t.code, k: 'alt' });
  }
  for (const a of input.aliases) raw.push({ t: a.alias, c: a.code, k: 'alias' });
  for (const a of input.aliasesI18n) raw.push({ t: a.alias, c: a.code, k: 'alias', l: a.lang });
  // Curated titles override model translations: a code with curated titles in a language takes no model titles
  // in it, and a model title equal to a curated one (for any code) is dropped.
  for (const lang of ['ru', 'kk'] as const) {
    const curated = input.aliasesI18n.filter((a) => a.lang === lang);
    const curatedCodes = new Set(curated.map((a) => a.code));
    const curatedTitles = new Set(curated.map((a) => a.alias.trim().toLowerCase()));
    for (const tr of input.translations[lang]) {
      const title = tr.title.trim();
      if (!codeSet.has(tr.code) || !title || curatedCodes.has(tr.code) || curatedTitles.has(title.toLowerCase())) continue;
      raw.push({ t: title, c: tr.code, k: 'alt', l: lang });
    }
  }
  const primaryLocal = input.titlesPrimary ?? {};
  for (const lang of ['ru', 'kk'] as const) {
    for (const code of Object.keys(primaryLocal).sort()) if (codeSet.has(code) && primaryLocal[code][lang]) raw.push({ t: primaryLocal[code][lang], c: code, k: 'alias', l: lang });
  }
  // Local names the UI shows (first title per code): reviewed primary, then curated aliases, then model titles.
  const localTitles = { ru: orderLocal('ru'), kk: orderLocal('kk') };
  function orderLocal(lang: 'ru' | 'kk'): TranslatedTitle[] {
    const byCode = new Map<string, string[]>();
    const add = (code: string, title: string) => {
      const t = title.trim();
      if (!t || !codeSet.has(code)) return;
      const list = byCode.get(code) ?? [];
      if (!list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
      byCode.set(code, list);
    };
    for (const code of Object.keys(primaryLocal)) add(code, primaryLocal[code][lang]);
    for (const a of input.aliasesI18n) if (a.lang === lang) add(a.code, a.alias);
    for (const tr of input.translations[lang]) add(tr.code, tr.title);
    return [...byCode.keys()].sort().flatMap((code) => byCode.get(code)!.map((title) => ({ code, title })));
  }
  const titles = dedupeTitles(raw);
  const primaryTitles: Record<string, string> = {};
  for (const code of codes) primaryTitles[code] = titleOf.get(code)!.title;
  const searchIndex = buildSearchIndex(titles, primaryTitles, popularity);

  // ---- coverage and meta
  const allTasks = bundles.flatMap((b) => b.tasks);
  const share = (pred: (t: OccTask) => boolean) => round(allTasks.filter(pred).length / allTasks.length, 4);
  const categoryCounts: Record<Category, number> = { ai_does: 0, ai_speeds: 0, human_edge: 0, no_data: 0 };
  for (const t of allTasks) categoryCounts[t.evidence.category]++;
  const theoryHow: Record<string, number> = {};
  for (const t of allTasks) {
    const k = theoryOf.get(t.id)?.how ?? (t.evidence.theorySource === 'estimated' ? 'estimated_dwa' : 'none');
    theoryHow[k] = (theoryHow[k] ?? 0) + 1;
  }
  const meta: BuildMeta = {
    dataVersion: DATA_VERSION,
    onetRelease: src.onetRelease,
    constants: {
      THEORY_WEIGHT,
      WORK_GATE,
      AEI_PCT_FLOOR,
      ...CATEGORY_THRESHOLDS,
      HISTORY_MIN_PERIODS,
      AT_STAKE_AI_DOES: AT_STAKE_WEIGHTS.ai_does,
      AT_STAKE_AI_SPEEDS: AT_STAKE_WEIGHTS.ai_speeds,
      DEFAULT_WEEK_TASKS,
      DEFAULT_SHARE_MIN,
      DEFAULT_SHARE_MAX,
      ...Object.fromEntries(Object.entries(FREQ_PER_YEAR).map(([k, v]) => [`FREQ_PER_YEAR_${k}`, v])),
      RELATED_MIN_SIMILARITY: RELATED.minSimilarity,
      RELATED_MIN_SIMILARITY_ONET: RELATED.minSimilarityRelated,
    },
    formula: {
      theory: 'E1 = 1, E2 = 0.5, E0 = 0 (human label, else GPT-4, else mean over tasks sharing a DWA)',
      observedScore: 'observed ? 0.5 + 0.5 × automation share : 0 (observed = published in AEI 2026-06-26 with work use ≥ 50% in claude_ai or API)',
      exposure: `${THEORY_WEIGHT} × theory + ${1 - THEORY_WEIGHT} × observedScore`,
      categories:
        'ai_does: observed, automation ≥ 0.5, exposure ≥ 0.75; human_edge: exposure < 0.25 or physical without observations; ai_speeds: other exposure ≥ 0.25; no_data: no label and not observed',
    },
    counts: {
      occupations: src.occupations.length,
      occupationsWithTasks: bundles.length,
      tasks: allTasks.length,
      titles: titles.length,
      aliases: input.aliases.length,
      aliasesI18n: input.aliasesI18n.length,
      translations: { ru: localTitles.ru.length, kk: localTitles.kk.length },
    },
    coverage: {
      importanceRated: share((t) => t.importance !== null),
      gptsLabel: share((t) => t.evidence.theorySource === 'human' || t.evidence.theorySource === 'gpt4' || t.evidence.theorySource === 'human+gpt4'),
      theoryHumanGpt4Mean: share((t) => t.evidence.theorySource === 'human+gpt4'),
      shortFromModel: share((t) => input.shortLabels?.[t.id] !== undefined),
      theoryEstimatedDwa: share((t) => t.evidence.theorySource === 'estimated'),
      theoryJoin: theoryHow,
      aeiPublished: share((t) => t.evidence.aeiShare !== null),
      aeiObservedWorkGated: share((t) => t.evidence.observed),
      aeiEverObserved: share((t) => t.evidence.everObserved),
      aeiHistory: share((t) => t.evidence.history !== null),
      aeiOlderReleases: oldMatch,
      penetration: share((t) => t.evidence.penetration !== null),
      penetrationAboveZero: share((t) => (t.evidence.penetration ?? 0) > 0),
      physicalFlag: share((t) => t.evidence.physical !== null),
      wage: round(bundles.filter((b) => b.wage.medianAnnual !== null).length / bundles.length, 4),
      wageMatch: { ...wageMap.matched, unmatched: wageMap.unmatched.length },
      wageUnmatchedCodes: wageMap.unmatched,
      wageShared: round(bundles.filter((b) => b.wage.sharedWith > 1).length / bundles.length, 4),
      related: round(bundles.filter((b) => b.related.length > 0).length / bundles.length, 4),
      categories: categoryCounts,
      evidenceLevels: {
        observed: allTasks.filter((t) => t.evidence.evidenceLevel === 'observed').length,
        estimate: allTasks.filter((t) => t.evidence.evidenceLevel === 'estimate').length,
        none: allTasks.filter((t) => t.evidence.evidenceLevel === 'none').length,
      },
    },
    rankBasis,
    validation: [
      validateAgainst(atStake, src.jobExposure ?? [], 'anthropic', 'Anthropic observed_exposure (labor market impacts, 2026)'),
      validateAgainst(atStake, src.msApplicability ?? [], 'microsoft', 'Microsoft ai_applicability_score (Working with AI)'),
    ].filter((v) => v.n > 0),
    aeiReleaseMaxShare: Math.max(0, ...allTasks.map((t) => t.evidence.aeiShare ?? 0)),
    sources: src.files,
    attribution: ATTRIBUTION,
  };

  return { bundles, titles, index, searchIndex, meta, related: relatedFull, localTitles, translationsModel: input.translationsModel ?? '' };
}

export interface BuildMeta {
  dataVersion: DataVersion;
  onetRelease: string;
  constants: Record<string, number>;
  formula: Record<string, string>;
  counts: Record<string, unknown>;
  coverage: Record<string, unknown>;
  rankBasis: 'bls_employment' | 'title_count';
  /** Spearman ρ of the typical-week at-stake share against published occupation-level measures. */
  validation: ValidationRow[];
  /** Largest aeiShare of any task (scale maximum for the EvidenceMeter). */
  aeiReleaseMaxShare: number;
  sources: RawSources['files'];
  attribution: typeof ATTRIBUTION;
}

/** research/data-sources.md §8, verbatim; licence names per source. */
export const ATTRIBUTION = {
  onet: {
    license: 'CC BY 4.0',
    text: 'This product includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. Irreplaceable has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications. O*NET® is a trademark of USDOL/ETA.',
    url: 'https://www.onetcenter.org/database.html',
  },
  aei: {
    license: 'CC BY',
    text: 'AI usage data: Anthropic Economic Index (release 2026-06-26, CC BY), Massenkoff et al., "Anthropic Economic Index report: Cadences", 2026; Massenkoff and McCrory, "Labor market impacts", 2026.',
    url: 'https://huggingface.co/datasets/Anthropic/EconomicIndex',
  },
  gpts: {
    license: 'MIT',
    text: 'Task exposure labels: Eloundou, Manning, Mishkin, Rock, "GPTs are GPTs", Science 2024; data from github.com/openai/GPTs-are-GPTs (MIT).',
    url: 'https://github.com/openai/GPTs-are-GPTs',
  },
  ms: {
    license: 'CC BY 4.0',
    text: 'Tomlinson et al., "Working with AI", NeurIPS 2026; github.com/microsoft/working-with-ai (CC BY 4.0).',
    url: 'https://github.com/microsoft/working-with-ai',
  },
  bls: {
    license: 'Public domain',
    text: 'Wages: U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, May 2025 (public domain).',
    url: 'https://www.bls.gov/oes/tables.htm',
  },
} as const;

function groupElements(rows: [string, string, string, number][]): Map<string, [string, string, number][]> {
  const m = new Map<string, [string, string, number][]>();
  for (const [code, id, name, v] of rows) {
    if (!m.has(code)) m.set(code, []);
    m.get(code)!.push([id, name, v]);
  }
  return m;
}

function topElements(rows: [string, string, number][] | undefined, n: number) {
  return [...(rows ?? [])]
    .sort((a, b) => b[2] - a[2] || cmp(a[0], b[0]))
    .slice(0, n)
    .map(([id, name, v]) => ({ id, name, importance: round(v, 2) }));
}

function dedupeTitles(raw: TitleIndexEntry[]): TitleIndexEntry[] {
  const best = new Map<string, TitleIndexEntry>();
  for (const e of raw) {
    // One entry per language: "бухгалтер" is both a Russian and a Kazakh title and each locale must find its own.
    const key = `${e.c}|${e.l ?? ''}|${e.t.trim().toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || KIND_ORDER[e.k] < KIND_ORDER[prev.k]) best.set(key, { ...e, t: e.t.trim() });
  }
  return [...best.values()].sort((a, b) => cmp(a.c, b.c) || KIND_ORDER[a.k] - KIND_ORDER[b.k] || cmp(a.t, b.t) || cmp(a.l ?? '', b.l ?? ''));
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
