// npm exec tsx scripts/data/inspect.ts [code ...] [-- --q "query" ...]
// Prints tasks with evidence and category for occupations, and search results for queries, from data/build.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { explainCategory } from '../../src/domain/evidence';
import { loadSearchIndex, searchOccupations, type SearchIndexFile } from '../../src/domain/search';
import { defaultShares } from '../../src/domain/shares';
import type { OccupationBundle } from '../../src/domain/types';
import { computeXray } from '../../src/domain/xray';

const ROOT = join(__dirname, '..', '..');
const args = process.argv.slice(2);
const qi = args.indexOf('--q');
const codes = qi < 0 ? args : args.slice(0, qi);
const queries = qi < 0 ? [] : args.slice(qi + 1);

for (const code of codes) {
  const b = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'occ', `${code}.json`), 'utf8')) as OccupationBundle;
  const { result } = computeXray(b, defaultShares(b));
  console.log(`\n${b.code} ${b.title} | zone ${b.jobZone} | wage ${b.wage.medianAnnual} (${b.wage.soc}, shared ${b.wage.sharedWith}) | typical human ${b.typicalHumanShare}`);
  console.log(`  default week: percent ${JSON.stringify(result.percent)} observedShare ${result.observedShare} score ${result.score} payAtStake ${result.payAtStake}`);
  for (const t of b.tasks) {
    const e = t.evidence;
    const ex = explainCategory(e);
    console.log(
      `  ${t.id.padStart(5)} imp ${String(t.importance).padEnd(4)} ${e.category.padEnd(10)} ${e.evidenceLevel.padEnd(8)} x=${e.exposure.toFixed(2)} ${e.theoryLabel ?? '--'} auto=${e.aeiAutomation ?? '-'} work=${e.aeiWorkShare ?? '-'} phys=${e.physical} ${ex.key.replace('category.explain.', '')} | ${t.text.slice(0, 80)}`,
    );
  }
  console.log('  related:', b.related.map((r) => `${r.title} (${r.similarity}, h ${r.typicalHumanShare}, $${r.wageDelta})`).join('; '));
}

if (queries.length) {
  const idx = loadSearchIndex(JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'search-index.json'), 'utf8')) as SearchIndexFile);
  for (const q of queries) {
    const t0 = performance.now();
    const r = searchOccupations(idx, q);
    const ms = (performance.now() - t0).toFixed(1);
    console.log(`\n"${q}" (${ms} ms):`, r.results.slice(0, 3).map((h) => `${h.code} ${h.title.slice(0, 40)} [${h.matched} ${h.kind} ${h.score}]`).join(' | '), r.suggestions.length ? `suggest ${JSON.stringify(r.suggestions)}` : '');
  }
}
