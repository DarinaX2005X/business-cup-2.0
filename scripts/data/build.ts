// npm run data:build [-- --force] [-- --no-cache]
// Downloads missing sources into data/raw/, parses them and writes the published data:
//   public/data/occ/<code>.json, data/build/{titles,search-index,index,meta,manifest}.json,
//   tests/fixtures/occupations/<code>.json (copies for UI work and tests).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, type AliasEntry, type AssembleInput, type BuildOutput, type TranslatedTitle } from '../../src/domain/data/assemble';
import { sha256 } from './io';
import { ROOT, ensureSources, findBlsCsv, loadSources } from './load';

export const OUT_BUILD = join(ROOT, 'data', 'build');
export const OUT_OCC = join(ROOT, 'public', 'data', 'occ');
export const FIXTURES = join(ROOT, 'tests', 'fixtures', 'occupations');
export const FIXTURE_CODES = ['29-1141.00', '29-2061.00', '13-2011.00', '47-2111.00', '43-4051.00', '25-2022.00', '23-2011.00', '43-5032.00'];

/** Hand-written dictionaries and model translations that join the raw sources. */
export function readDictionaries(): Omit<AssembleInput, 'sources'> {
  const read = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback);
  const aliases = read<AliasEntry[]>(join(ROOT, 'data', 'aliases.json'), []);
  const aliasesI18n = read<AliasEntry[]>(join(ROOT, 'data', 'aliases.i18n.json'), []);
  const tr = (lang: 'ru' | 'kk') => read<{ items: TranslatedTitle[] }>(join(OUT_BUILD, `titles.${lang}.json`), { items: [] }).items;
  return { aliases, aliasesI18n, translations: { ru: tr('ru'), kk: tr('kk') } };
}

/** Serialise every output file deterministically: path → content. */
export function serialize(out: BuildOutput): Map<string, string> {
  const files = new Map<string, string>();
  for (const b of out.bundles) files.set(`public/data/occ/${b.code}.json`, JSON.stringify(b));
  files.set('data/build/titles.json', JSON.stringify(out.titles));
  files.set('data/build/search-index.json', JSON.stringify(out.searchIndex));
  files.set('data/build/index.json', JSON.stringify(out.index));
  files.set('data/build/meta.json', JSON.stringify(out.meta, null, 2));
  return files;
}

export function manifestOf(files: Map<string, string>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const k of [...files.keys()].sort()) m[k] = sha256(files.get(k)!);
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const t0 = Date.now();
  const log = (s: string) => console.log(`[data] ${s}`);

  await ensureSources(force, log);
  if (!findBlsCsv()) {
    console.warn(
      '[data] WARNING: BLS OEWS May 2025 not found in data/raw/bls_oews_may2025_nat/ (download oesm25nat.zip in a browser and save the first sheet as CSV). Wages will be null.',
    );
  }
  const sources = await loadSources(log, !args.includes('--no-cache') && !force);
  log('assembling');
  const out = assemble({ sources, ...readDictionaries() });
  const files = serialize(out);

  mkdirSync(OUT_BUILD, { recursive: true });
  mkdirSync(OUT_OCC, { recursive: true });
  const keep = new Set(out.bundles.map((b) => `${b.code}.json`));
  for (const f of readdirSync(OUT_OCC)) if (!keep.has(f)) rmSync(join(OUT_OCC, f));
  for (const [rel, content] of files) writeFileSync(join(ROOT, rel), content);
  const manifest = manifestOf(files);
  writeFileSync(join(OUT_BUILD, 'manifest.json'), JSON.stringify({ outputs: manifest, hash: sha256(JSON.stringify(manifest)) }, null, 2));

  mkdirSync(FIXTURES, { recursive: true });
  for (const code of FIXTURE_CODES) writeFileSync(join(FIXTURES, `${code}.json`), JSON.stringify(out.bundles.find((b) => b.code === code), null, 1));

  // ---- summary
  const m = out.meta;
  const c = m.coverage as Record<string, unknown>;
  const pct = (x: unknown) => `${((x as number) * 100).toFixed(1)}%`;
  const bytes = [...files.entries()].filter(([k]) => k.startsWith('public/')).reduce((a, [, v]) => a + Buffer.byteLength(v), 0);
  console.log('');
  console.log(`O*NET ${m.dataVersion.onet} (${m.onetRelease}): ${m.counts.occupationsWithTasks} occupations with tasks, ${m.counts.tasks} tasks, ${m.counts.titles} title strings`);
  console.log(`importance rated ${pct(c.importanceRated)} | GPTs label ${pct(c.gptsLabel)} (+${pct(c.theoryEstimatedDwa)} DWA estimate)`);
  console.log(`AEI 2026-06-26 published ${pct(c.aeiPublished)} | observed after work gate ${pct(c.aeiObservedWorkGated)} | ever observed since Aug 2025 ${pct(c.aeiEverObserved)} | history ${pct(c.aeiHistory)}`);
  console.log(`task_penetration ${pct(c.penetration)} (>0: ${pct(c.penetrationAboveZero)}) | physical flag ${pct(c.physicalFlag)}`);
  console.log(`BLS wage ${pct(c.wage)} ${JSON.stringify(c.wageMatch)} | shared wage ${pct(c.wageShared)} | ranking by ${m.rankBasis}`);
  console.log(`related filled ${pct(c.related)} | categories ${JSON.stringify(c.categories)} | evidence ${JSON.stringify(c.evidenceLevels)}`);
  console.log(`bundles ${(bytes / 1e6).toFixed(2)} MB | search index ${(Buffer.byteLength(files.get('data/build/search-index.json')!) / 1e6).toFixed(2)} MB | manifest ${sha256(JSON.stringify(manifest)).slice(0, 12)} | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && /build\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
