// Source list (URLs from research/data-sources.md), downloads, extraction and parsing into RawSources.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RawAeiTask, RawOewsRow, RawSourceFile, RawSources } from '../../src/domain/data/raw';
import { download, readTsv, sha256, sha256File, streamCsv, unzip } from './io';

export const ROOT = join(__dirname, '..', '..');
export const RAW = join(ROOT, 'data', 'raw');
const CACHE = join(RAW, '.cache', 'sources.json');
const LOADER_VERSION = 7;

const HF = 'https://huggingface.co/datasets/Anthropic/EconomicIndex/resolve/main';

export interface SourceSpec {
  id: string;
  file: string; // relative to data/raw
  url: string | null; // null = placed by hand
}

export const SOURCES: SourceSpec[] = [
  { id: 'onet', file: 'onet_31_0_text/db_31_0_text.zip', url: 'https://www.onetcenter.org/dl_files/database/db_31_0_text.zip' },
  { id: 'aei_latest_claude_ai', file: 'aei_2026_06_26/aei_claude_ai_2026-06-26.csv', url: `${HF}/release_2026_06_26/data/aei_claude_ai_2026-06-26.csv` },
  { id: 'aei_latest_1p_api', file: 'aei_2026_06_26/aei_1p_api_2026-06-26.csv', url: `${HF}/release_2026_06_26/data/aei_1p_api_2026-06-26.csv` },
  { id: 'aei_2026_02_claude_ai', file: 'aei_2026_03_24/aei_raw_claude_ai_2026-02-05_to_2026-02-12.csv', url: `${HF}/release_2026_03_24/data/aei_raw_claude_ai_2026-02-05_to_2026-02-12.csv` },
  { id: 'aei_2026_02_1p_api', file: 'aei_2026_03_24/aei_raw_1p_api_2026-02-05_to_2026-02-12.csv', url: `${HF}/release_2026_03_24/data/aei_raw_1p_api_2026-02-05_to_2026-02-12.csv` },
  { id: 'aei_2025_11_claude_ai', file: 'aei_2026_01_15/aei_raw_claude_ai_2025-11-13_to_2025-11-20.csv', url: `${HF}/release_2026_01_15/data/intermediate/aei_raw_claude_ai_2025-11-13_to_2025-11-20.csv` },
  { id: 'aei_2025_08_claude_ai', file: 'aei_2025_09_15/aei_raw_claude_ai_2025-08-04_to_2025-08-11.csv', url: `${HF}/release_2025_09_15/data/intermediate/aei_raw_claude_ai_2025-08-04_to_2025-08-11.csv` },
  { id: 'aei_task_penetration', file: 'aei_labor_market_impacts/task_penetration.csv', url: `${HF}/labor_market_impacts/task_penetration.csv` },
  { id: 'gpts_full_labelset', file: 'gpts_are_gpts/full_labelset.tsv', url: 'https://raw.githubusercontent.com/openai/GPTs-are-GPTs/main/data/full_labelset.tsv' },
  { id: 'ms_physical_tasks', file: 'ms_working_with_ai/physical_tasks.csv', url: 'https://raw.githubusercontent.com/microsoft/working-with-ai/main/physical_tasks.csv' },
  // Validation only (meta.validation): occupation-level measures we compare our indicator with.
  { id: 'aei_job_exposure', file: 'aei_labor_market_impacts/job_exposure.csv', url: `${HF}/labor_market_impacts/job_exposure.csv` },
  { id: 'ms_ai_applicability', file: 'ms_working_with_ai/ai_applicability_scores.csv', url: 'https://raw.githubusercontent.com/microsoft/working-with-ai/main/ai_applicability_scores.csv' },
];

/** BLS blocks scripted downloads; the national file is placed by hand (CSV of the xlsx's first sheet). */
export const BLS_DIR = join(RAW, 'bls_oews_may2025_nat');

const OLD_RELEASES = [
  { id: 'aei_2025_08_claude_ai', release: '2025-09-15', source: 'claude_ai', period: '2025-08' },
  { id: 'aei_2025_11_claude_ai', release: '2026-01-15', source: 'claude_ai', period: '2025-11' },
  { id: 'aei_2026_02_claude_ai', release: '2026-03-24', source: 'claude_ai', period: '2026-02' },
  { id: 'aei_2026_02_1p_api', release: '2026-03-24', source: '1p_api', period: '2026-02' },
] as const;

const path = (id: string) => join(RAW, SOURCES.find((s) => s.id === id)!.file);
const onetDir = () => join(RAW, 'onet_31_0_text', 'db_31_0_text');
const onetTable = (name: string) => readTsv(join(onetDir(), `${name}.txt`));

export async function ensureSources(force: boolean, log: (s: string) => void): Promise<void> {
  for (const s of SOURCES) {
    const target = join(RAW, s.file);
    if (existsSync(target) && !force) continue;
    log(`downloading ${s.url}`);
    await download(s.url!, target);
  }
  if (force || !existsSync(join(onetDir(), 'Task Statements.txt'))) {
    log('extracting O*NET 31.0 text archive');
    unzip(path('onet'), join(RAW, 'onet_31_0_text'));
  }
}

export function findBlsCsv(): string | null {
  if (!existsSync(BLS_DIR)) return null;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : d.name.toLowerCase().endsWith('.csv') ? [join(dir, d.name)] : [],
    );
  return walk(BLS_DIR).sort()[0] ?? null;
}

/** Load all sources, using data/raw/.cache/sources.json when no input file changed since it was written. */
export async function loadSources(log: (s: string) => void, useCache = true): Promise<RawSources> {
  const bls = findBlsCsv();
  const inputs = [...SOURCES.map((s) => join(RAW, s.file)), ...(bls ? [bls] : [])];
  const key = sha256(JSON.stringify([LOADER_VERSION, inputs.map((f) => [relative(RAW, f), statSync(f).size, statSync(f).mtimeMs])]));
  if (useCache && existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, 'utf8')) as { key: string; sources: RawSources };
    if (cached.key === key) {
      log('sources: using parsed cache (inputs unchanged)');
      return cached.sources;
    }
  }
  const sources = await parseSources(bls, log);
  mkdirSync(join(RAW, '.cache'), { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ key, sources }));
  return sources;
}

/** Read the parsed cache without touching raw files (used by the determinism test). */
export function readCachedSources(): RawSources | null {
  if (!existsSync(CACHE)) return null;
  return (JSON.parse(readFileSync(CACHE, 'utf8')) as { sources: RawSources }).sources;
}

async function parseSources(bls: string | null, log: (s: string) => void): Promise<RawSources> {
  log('parsing O*NET 31.0');
  const readme = readFileSync(join(onetDir(), 'Read Me.txt'), 'utf8');
  const onetRelease = /([A-Z][a-z]+ \d{4}) Release/.exec(readme)?.[1] ?? 'unknown';
  const num = (s: string) => (s === '' || s === 'n/a' ? NaN : Number(s));

  const occupations = onetTable('Occupation Data').map((r) => ({ code: r['O*NET-SOC Code'], title: r.Title, description: r.Description }));
  const tasks = onetTable('Task Statements').map((r) => ({ code: r['O*NET-SOC Code'], id: r['Task ID'], text: r.Task, type: r['Task Type'] }));
  const ratings = onetTable('Task Ratings')
    .filter((r) => r['Scale ID'] === 'IM' || r['Scale ID'] === 'RT' || r['Scale ID'] === 'FT')
    .map((r) => [r['O*NET-SOC Code'], r['Task ID'], r['Scale ID'], r.Category, num(r['Data Value'])] as [string, string, string, string, number])
    .filter((r) => Number.isFinite(r[4]));
  const jobTitles = onetTable('Job Titles').map((r) => ({
    code: r['O*NET-SOC Code'],
    title: r['Job Title'],
    short: r['Short Title'] && r['Short Title'] !== 'n/a' ? r['Short Title'] : null,
  }));
  const reportedTitles = onetTable('Sample of Reported Titles').map((r) => ({ code: r['O*NET-SOC Code'], title: r['Reported Job Title'] }));
  const importance = (name: string) =>
    onetTable(name)
      .filter((r) => r['Scale ID'] === 'IM' && Number.isFinite(num(r['Data Value'])))
      .map((r) => [r['O*NET-SOC Code'], r['Element ID'], r['Element Name'], num(r['Data Value'])] as [string, string, string, number]);
  const skills = [...importance('Essential Skills'), ...importance('Transferable Skills')];
  const knowledge = importance('Knowledge');
  const gwaTable = onetTable('GWAs to IWAs to DWAs');
  const dwaGwa = gwaTable.map((r) => [r['DWA Element ID'], r['GWA Element ID']] as [string, string]);
  const dwaNames = gwaTable.map((r) => [r['DWA Element ID'], r['DWA Element Name']] as [string, string]);
  const taskDwas = onetTable('Tasks to DWAs').map((r) => [r['Task ID'], r['DWA Element ID']] as [string, string]);
  const related = onetTable('Related Occupations').map((r) => ({
    code: r['O*NET-SOC Code'],
    related: r['Related O*NET-SOC Code'],
    tier: r['Relatedness Tier'],
    index: Number(r.Index),
  }));
  const education = onetTable('Education')
    .filter((r) => r['Scale ID'] === 'RL' && Number.isFinite(num(r['Data Value'])))
    .map((r) => [r['O*NET-SOC Code'], Number(r.Category), num(r['Data Value'])] as [string, number, number]);
  const jobZones = onetTable('Job Zones').map((r) => [r['O*NET-SOC Code'], Number(r['Job Zone'])] as [string, number]);

  log('parsing GPTs-are-GPTs, Microsoft, task_penetration');
  const gpts: RawSources['gpts'] = [];
  const gl = readFileSync(path('gpts_full_labelset'), 'utf8').split(/\r?\n/);
  const gh = gl[0].split('\t');
  const col = (n: string) => gh.indexOf(n);
  const unq = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);
  for (let i = 1; i < gl.length; i++) {
    if (!gl[i]) continue;
    const c = gl[i].split('\t');
    const id = c[col('Task ID')];
    if (!id) continue;
    const label = (v: string | undefined): 'E0' | 'E1' | 'E2' | null => (v === 'E0' || v === 'E1' || v === 'E2' ? v : null);
    gpts.push({ taskId: String(Math.round(Number(id))), text: unq(c[col('Task')]), human: label(c[col('human_exposure_agg')]), gpt4: label(c[col('gpt4_exposure')]) });
  }
  const physical: [string, boolean][] = [];
  await streamCsv(path('ms_physical_tasks'), (r) => physical.push([r[0], r[1] === 'True']));
  const jobExposure: [string, number][] = [];
  await streamCsv(path('aei_job_exposure'), (r) => jobExposure.push([r[0], Number(r[2])]));
  const msApplicability: [string, number][] = [];
  await streamCsv(path('ms_ai_applicability'), (r) => msApplicability.push([r[0], Number(r[2])]));
  const penetration: [string, number][] = [];
  await streamCsv(path('aei_task_penetration'), (r) => penetration.push([r[0], Number(r[1])]));

  const aei = { claude_ai: [] as RawAeiTask[], '1p_api': [] as RawAeiTask[] };
  for (const src of ['claude_ai', '1p_api'] as const) {
    log(`parsing AEI 2026-06-26 ${src}`);
    const byKey = new Map<string, RawAeiTask>();
    await streamCsv(
      path(`aei_latest_${src}`),
      (r) => {
        // date_start,date_end,geo_id,geo_level,category_name,hierarchy_level,metric_id,value,node_name,node_external_id
        const [dateStart, , , geoLevel, cat, level, metric, value, name, extId] = r;
        if (geoLevel !== 'global' || cat !== 'onet' || level !== '0' || !extId) return;
        const field = AEI_METRICS[metric];
        if (!field) return;
        const k = `${extId}|${dateStart}`;
        let t = byKey.get(k);
        if (!t) {
          t = { taskId: extId, text: name, period: dateStart, pct: null, automation: null, augmentation: null, work: null };
          byKey.set(k, t);
        }
        t[field] = Number(value);
      },
      (line) => line.includes(',GLOBAL,global,onet,0,'),
    );
    aei[src] = [...byKey.values()].sort((a, b) => cmp(a.taskId, b.taskId) || cmp(a.period, b.period));
  }

  const aeiOld: RawSources['aeiOld'] = [];
  for (const rel of OLD_RELEASES) {
    log(`parsing AEI ${rel.release} ${rel.source}`);
    const rows: [string, number][] = [];
    await streamCsv(
      path(rel.id),
      (r) => {
        // geo_id,geography,date_start,date_end,platform_and_product,facet,level,variable,cluster_name,value
        if (r[0] !== 'GLOBAL' || r[5] !== 'onet_task' || r[7] !== 'onet_task_pct') return;
        if (r[8] === 'none' || r[8] === 'not_classified') return;
        rows.push([r[8], Number(r[9])]);
      },
      (line) => line.startsWith('GLOBAL,') && line.includes(',onet_task_pct,'),
    );
    aeiOld.push({ release: rel.release, source: rel.source, period: rel.period, rows });
  }

  let oews: RawOewsRow[] | null = null;
  if (bls) {
    log(`parsing BLS OEWS ${relative(RAW, bls)}`);
    oews = [];
    const rows = oews;
    await streamCsv(bls, (r, h) => {
      const g = (n: string) => r[h.indexOf(n)] ?? '';
      rows.push({
        occ: g('OCC_CODE'),
        title: g('OCC_TITLE'),
        group: g('O_GROUP'),
        totEmp: g('TOT_EMP'),
        aMedian: g('A_MEDIAN'),
        hMedian: g('H_MEDIAN'),
        annualOnly: g('ANNUAL').toUpperCase() === 'TRUE',
        hourlyOnly: g('HOURLY').toUpperCase() === 'TRUE',
      });
    });
  }

  log('hashing raw files');
  const files: RawSourceFile[] = [];
  for (const s of SOURCES) {
    const f = join(RAW, s.file);
    files.push({ id: s.id, file: s.file.replace(/\\/g, '/'), url: s.url, bytes: statSync(f).size, sha256: await sha256File(f) });
  }
  if (bls) files.push({ id: 'bls_oews_may2025_nat', file: relative(RAW, bls).replace(/\\/g, '/'), url: 'https://www.bls.gov/oes/special-requests/oesm25nat.zip', bytes: statSync(bls).size, sha256: await sha256File(bls) });

  return { onetRelease, occupations, tasks, ratings, jobTitles, reportedTitles, skills, knowledge, taskDwas, dwaGwa, dwaNames, related, jobZones, education, gpts, physical, penetration, jobExposure, msApplicability, aei, aeiOld, oews, files };
}

const AEI_METRICS: Record<string, 'pct' | 'automation' | 'augmentation' | 'work'> = {
  pct: 'pct',
  collaboration_bucket_automation_pct: 'automation',
  collaboration_bucket_augmentation_pct: 'augmentation',
  use_case_work_pct: 'work',
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

