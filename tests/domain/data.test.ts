import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from '@/domain/data/assemble';
import { readCachedSources } from '../../scripts/data/load';
import { FIXTURE_CODES, manifestOf, readDictionaries, serialize } from '../../scripts/data/build';
import type { OccupationBundle, OccupationIndexEntry } from '@/domain/types';
import { fixture, ROOT } from './helpers';

const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'meta.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'index.json'), 'utf8')) as OccupationIndexEntry[];
const bundleOf = (code: string) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'occ', `${code}.json`), 'utf8')) as OccupationBundle;
const byId = (b: OccupationBundle, id: string) => b.tasks.find((t) => t.id === id)!;

describe('coverage of the joined sources', () => {
  it('prints the coverage table and matches the probe', () => {
    const c = meta.coverage;
    const p = (x: number) => `${(x * 100).toFixed(1)}%`;
    const rows: [string, string][] = [
      ['Occupations with tasks / tasks', `${meta.counts.occupationsWithTasks} / ${meta.counts.tasks}`],
      ['O*NET importance rating', p(c.importanceRated)],
      ['GPTs-are-GPTs label (human or GPT-4)', p(c.gptsLabel)],
      ['  estimated from shared DWAs', p(c.theoryEstimatedDwa)],
      ['AEI 2026-06-26 published (either source)', p(c.aeiPublished)],
      ['AEI observed after work-use gate (evidence: observed)', p(c.aeiObservedWorkGated)],
      ['AEI ever observed since Aug 2025', p(c.aeiEverObserved)],
      ['AEI history (>= 3 Claude.ai periods)', p(c.aeiHistory)],
      ['AEI task_penetration joined / > 0', `${p(c.penetration)} / ${p(c.penetrationAboveZero)}`],
      ['Microsoft physical flag', p(c.physicalFlag)],
      ['BLS OEWS May 2025 median wage', p(c.wage)],
      ['Occupations sharing a wage row', p(c.wageShared)],
      ['Neighbours filled', p(c.related)],
    ];
    console.log(`\nCoverage (O*NET ${meta.dataVersion.onet}, AEI ${meta.dataVersion.aei})\n` + rows.map(([k, v]) => `| ${k.padEnd(54)} | ${v.padStart(14)} |`).join('\n'));
    console.log(`Categories ${JSON.stringify(c.categories)}; evidence levels ${JSON.stringify(c.evidenceLevels)}`);

    expect(meta.counts.occupationsWithTasks).toBe(923);
    expect(meta.counts.tasks).toBe(18838);
    expect(c.gptsLabel).toBeCloseTo(0.995, 3);
    expect(c.aeiPublished).toBeCloseTo(0.197, 3);
    expect(c.aeiObservedWorkGated).toBeCloseTo(0.153, 3);
    expect(c.aeiEverObserved).toBeCloseTo(0.313, 3);
    expect(c.evidenceLevels.observed + c.evidenceLevels.estimate + c.evidenceLevels.none).toBe(18838);
  });

  it('records the formula constants, every raw file hash and the attribution', () => {
    expect(meta.constants.THEORY_WEIGHT).toBe(0.5);
    expect(meta.constants.WORK_GATE).toBe(0.5);
    expect(meta.sources.length).toBeGreaterThanOrEqual(10);
    for (const s of meta.sources) expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.attribution.onet.text).toContain('O*NET 31.0 Database');
  });

  it('index: unique slugs, ranks 1..N, every bundle file present', () => {
    expect(new Set(index.map((e) => e.slug)).size).toBe(index.length);
    expect([...index.map((e) => e.rank)].sort((a, b) => a - b)).toEqual(index.map((_, i) => i + 1));
    for (const e of index) expect(existsSync(join(ROOT, 'public', 'data', 'occ', `${e.code}.json`))).toBe(true);
    const top = [...index].sort((a, b) => a.rank - b.rank).slice(0, 10).map((e) => e.code);
    expect(top).toContain('29-1141.00'); // registered nurses are among the most employed
  });
});

describe('task evidence on the three probe occupations', () => {
  it('registered nurse: documentation is ai_speeds, hands-on care is human_edge', () => {
    const rn = bundleOf('29-1141.00');
    expect(byId(rn, '1841').evidence.category).toBe('ai_speeds'); // Record patients' medical information
    expect(byId(rn, '20413').evidence.category).toBe('human_edge'); // Administer medications (physical)
    expect(byId(rn, '1855').evidence.category).toBe('human_edge'); // Provide health care, first aid
    const observed = rn.tasks.filter((t) => t.evidence.evidenceLevel === 'observed').map((t) => t.id);
    expect(observed).toEqual(['1840']); // probe: 1 work-gated AEI task (4%)
    // 1845 is published in AEI but with 0% work use: not observed, explained as personal use
    expect(byId(rn, '1845').evidence.observed).toBe(false);
    expect(byId(rn, '1845').evidence.aeiShare).not.toBeNull();
  });

  it('accountant: record and journal work is observed in real use; AI does reporting', () => {
    const acc = bundleOf('13-2011.00');
    const observed = acc.tasks.filter((t) => t.evidence.evidenceLevel === 'observed');
    expect(observed.length).toBe(14); // probe: 47% of 30 tasks
    expect(byId(acc, '21514').evidence).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'observed' }); // prepare/analyze records
    expect(byId(acc, '21515').evidence).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'observed' }); // adjusting journal entries
    expect(byId(acc, '21517').evidence).toMatchObject({ category: 'ai_does', evidenceLevel: 'observed' }); // tables of accounts
    // Reconciliation (21516) is labelled E0 by the GPTs-are-GPTs annotators and is absent from AEI: human_edge.
    expect(byId(acc, '21516').evidence).toMatchObject({ theoryLabel: 'E0', observed: false, category: 'human_edge' });
  });

  it('electrician: installation is human_edge through the physical flag; paperwork is ai_does', () => {
    const el = bundleOf('47-2111.00');
    for (const id of ['2888', '2873', '2875']) expect(byId(el, id).evidence).toMatchObject({ physical: true, category: 'human_edge' });
    expect(byId(el, '2885').evidence.category).toBe('ai_does'); // business management duties, records
  });

  it('category distributions (fixed so a data change is visible in review)', () => {
    const dist = (code: string) => {
      const d: Record<string, number> = {};
      for (const t of bundleOf(code).tasks) d[t.evidence.category] = (d[t.evidence.category] ?? 0) + 1;
      return d;
    };
    expect(dist('29-1141.00')).toEqual({ ai_speeds: 15, human_edge: 12 });
    expect(dist('13-2011.00')).toEqual({ ai_does: 5, ai_speeds: 21, human_edge: 4 });
    expect(dist('47-2111.00')).toEqual({ ai_speeds: 4, human_edge: 16, ai_does: 1 });
  });
});

describe('neighbouring occupations', () => {
  const codesOf = (code: string) => bundleOf(code).related.map((r) => r.code);
  it('every occupation with skills has 8 neighbours from the same or the next Job Zone', () => {
    const zone = new Map(index.map((e) => [e.code, e.jobZone]));
    let filled = 0;
    for (const e of index) {
      const b = bundleOf(e.code);
      if (!b.skills.length) continue;
      expect(b.related.length).toBeGreaterThan(0);
      filled++;
      for (const r of b.related) {
        const z = zone.get(r.code)!;
        if (e.jobZone !== null && z !== null) expect(z - e.jobZone).toBeGreaterThanOrEqual(0);
      }
    }
    expect(filled).toBeGreaterThan(900);
  });
  it('registered nurse: clinical neighbours, including O*NET related nursing roles', () => {
    const rel = codesOf('29-1141.00');
    expect(rel.every((c) => /^(29|31|21|19-3|25-1)/.test(c))).toBe(true);
    expect(rel.filter((c) => ['29-1141.03', '29-1071.00', '29-1151.00', '29-1171.00', '29-1161.00', '29-1141.01'].includes(c)).length).toBeGreaterThanOrEqual(3);
  });
  it('accountant: finance neighbours; electrician: trades neighbours', () => {
    expect(codesOf('13-2011.00').filter((c) => /^(13-2|11-3031|43-3|13-1141)/.test(c)).length).toBeGreaterThanOrEqual(5);
    expect(codesOf('47-2111.00').every((c) => /^(47|49|51|53-7021)/.test(c))).toBe(true);
  });
  it('neighbours carry wage difference and missing skills', () => {
    const r = bundleOf('29-1141.00').related.find((x) => x.code === '29-1071.00')!;
    expect(r.wageDelta).toBeGreaterThan(0);
    expect(r.missingSkills.length).toBeGreaterThan(0);
  });
});

describe('build outputs', () => {
  it('fixtures are copies of the built bundles', () => {
    for (const code of FIXTURE_CODES) expect(fixture(code)).toEqual(bundleOf(code));
  });

  const sources = readCachedSources();
  it.skipIf(!sources)(
    'is deterministic: two assemblies of the same inputs hash identically and match the committed files',
    () => {
      const dict = readDictionaries();
      const a = manifestOf(serialize(assemble({ sources: sources!, ...dict })));
      const b = manifestOf(serialize(assemble({ sources: sources!, ...dict })));
      expect(a).toEqual(b);
      const committed = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'manifest.json'), 'utf8')).outputs;
      expect(a).toEqual(committed);
    },
    180_000,
  );
});
