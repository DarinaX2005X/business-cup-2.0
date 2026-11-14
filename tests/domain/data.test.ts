import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from '@/domain/data/assemble';
import { readCachedSources } from '../../scripts/data/load';
import { FIXTURE_CODES, manifestOf, readDictionaries, serialize } from '../../scripts/data/build';
import type { OccupationBundle, OccupationIndexEntry } from '@/domain/types';
import { fixture, ROOT } from './helpers';
import { defaultShares } from '@/domain/shares';
import { computeXray } from '@/domain/xray';

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
    expect(meta.constants.AT_STAKE_AI_DOES).toBe(1);
    expect(meta.constants.AT_STAKE_AI_SPEEDS).toBe(0.5);
    expect(meta.constants.aiDoesAutomation).toBe(0.6);
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

const dist = (code: string) => {
  const d: Record<string, number> = {};
  for (const t of bundleOf(code).tasks) d[t.evidence.category] = (d[t.evidence.category] ?? 0) + 1;
  return d;
};
const xrayOf = (code: string) => {
  const b = bundleOf(code);
  return computeXray(b, defaultShares(b)).result;
};

describe('task evidence on real occupations', () => {
  it('registered nurse: documentation is ai_speeds, hands-on care is human_edge', () => {
    const rn = bundleOf('29-1141.00');
    expect(byId(rn, '1841').evidence.category).toBe('ai_speeds'); // Record patients' medical information
    expect(byId(rn, '20413').evidence.category).toBe('human_edge'); // Administer medications (physical)
    expect(byId(rn, '1855').evidence.category).toBe('human_edge'); // Provide health care, first aid
    expect(byId(rn, '1840').evidence).toMatchObject({ evidenceLevel: 'observed', category: 'ai_does' }); // 93% automation
    expect(byId(rn, '1845').evidence).toMatchObject({ observed: false }); // published, 0% work use
  });

  it('accountant: observed work is ai_does / ai_speeds; reconciliation is no longer human_edge', () => {
    const acc = bundleOf('13-2011.00');
    expect(acc.tasks.filter((t) => t.evidence.evidenceLevel === 'observed')).toHaveLength(14);
    expect(byId(acc, '21514').evidence).toMatchObject({ category: 'ai_does', evidenceLevel: 'observed' });
    expect(byId(acc, '21517').evidence).toMatchObject({ category: 'ai_does', evidenceLevel: 'observed' });
    expect(byId(acc, '21516').evidence).toMatchObject({ theorySource: 'human+gpt4', category: 'ai_speeds' });
  });

  it('bookkeeping clerks: computer and payroll work is not human edge; checking postings is ai_does', () => {
    const bk = bundleOf('43-3031.00');
    expect(byId(bk, '2486').evidence).toMatchObject({ category: 'ai_does', evidenceLevel: 'observed' }); // Check figures, postings
    expect(byId(bk, '2487').evidence.category).toBe('ai_speeds'); // Operate computers programmed with accounting software
    expect(byId(bk, '18561').evidence.category).toBe('ai_speeds'); // Prepare and process payroll information
  });

  it('electrician: installation is human_edge through the physical flag; paperwork is ai_does', () => {
    const el = bundleOf('47-2111.00');
    for (const id of ['2888', '2873', '2875']) expect(byId(el, id).evidence).toMatchObject({ physical: true, category: 'human_edge' });
    expect(byId(el, '2885').evidence.category).toBe('ai_does');
  });

  it('a physical flag does not beat E1 writing tasks that Anthropic sees in use', () => {
    for (const [code, id] of [['11-9031.00', '5206'], ['11-9032.00', '5230'], ['11-2011.00', '3236']]) {
      expect(byId(bundleOf(code), id).evidence.category, `${code} ${id}`).toBe('ai_speeds');
    }
  });

  it('category distributions and base scores (fixed so a data change is visible in review)', () => {
    const rows = ['29-1141.00', '29-1141.03', '13-2011.00', '43-3031.00', '47-2111.00'].map((c) => ({ c, d: dist(c), base: xrayOf(c).baseScore }));
    console.log(rows.map((r) => `${r.c} ${JSON.stringify(r.d)} base ${r.base}`).join('\n'));
    expect(dist('29-1141.00')).toEqual({ ai_does: 1, ai_speeds: 16, human_edge: 10 });
    expect(dist('13-2011.00')).toEqual({ ai_does: 10, ai_speeds: 18, human_edge: 2 });
    expect(dist('47-2111.00')).toEqual({ ai_does: 1, ai_speeds: 8, human_edge: 12 });
    expect(dist('43-3031.00')).toEqual({ ai_does: 13, ai_speeds: 11, human_edge: 4 });
    expect(xrayOf('43-3031.00').baseScore).toBeLessThanOrEqual(xrayOf('13-2011.00').baseScore);
    expect(xrayOf('29-1141.00').baseScore).not.toBe(xrayOf('29-1141.03').baseScore);
  });

  it('every task has a short label of at most 4 words', () => {
    for (const code of ['29-1141.00', '13-2011.00', '47-2111.00', '43-3031.00']) {
      for (const t of bundleOf(code).tasks) {
        expect(t.short, t.id).toBeTruthy();
        expect(t.short!.split(' ').length, `${t.id} ${t.short}`).toBeLessThanOrEqual(4);
        expect(t.short).not.toMatch(/[.,;:]$/);
      }
    }
  });
});

describe('neighbouring occupations', () => {
  const codesOf = (code: string) => bundleOf(code).related.map((r) => r.code);
  const titlesOf = (code: string) => bundleOf(code).related.map((r) => r.title);

  it('neighbours are safer (or about as safe), similar, same or next Job Zone', () => {
    const zone = new Map(index.map((e) => [e.code, e.jobZone]));
    const share = new Map(index.map((e) => [e.code, e.typicalHumanShare]));
    let filled = 0;
    for (const e of index) {
      const b = bundleOf(e.code);
      if (b.related.length) filled++;
      for (const r of b.related) {
        const z = zone.get(r.code)!;
        if (e.jobZone !== null && z !== null) expect(z - e.jobZone).toBeGreaterThanOrEqual(0);
        expect(share.get(r.code)! - e.typicalHumanShare).toBeGreaterThanOrEqual(-0.05 - 1e-9);
        expect(r.similarity).toBeGreaterThanOrEqual(0.75);
      }
    }
    expect(filled / index.length).toBeGreaterThan(0.85);
  });

  it('registered nurse: nursing or health roles, no physicians or psychologists in the top 3', () => {
    const rel = codesOf('29-1141.00');
    const top3 = titlesOf('29-1141.00').slice(0, 3);
    expect(rel).toContain('29-1141.03'); // Critical Care Nurses
    expect(top3.some((t) => /Physician|Psycholog|Surgeon|ologists$/.test(t)), top3.join(', ')).toBe(false);
    expect(rel.every((c) => /^(29|31|21|25-1)/.test(c))).toBe(true);
  });

  it('customer service: customer-facing office roles, no gambling dealers or ushers', () => {
    const rel = codesOf('43-4051.00');
    expect(rel.filter((c) => c.startsWith('43-')).length).toBeGreaterThanOrEqual(5);
    expect(rel).not.toContain('39-3011.00'); // Gambling Dealers
    expect(rel).not.toContain('39-3031.00'); // Ushers, Lobby Attendants, and Ticket Takers
  });

  it('accountant: finance and business neighbours; electrician: trades neighbours', () => {
    expect(codesOf('13-2011.00').every((c) => /^(13|11)-/.test(c))).toBe(true);
    expect(codesOf('47-2111.00').every((c) => /^(47|49)-/.test(c))).toBe(true);
    expect(codesOf('47-2111.00')).toContain('47-2152.00'); // Plumbers
  });

  it('neighbours carry wage difference and missing skills', () => {
    const r = bundleOf('13-2011.00').related.find((x) => x.code === '11-3031.01')!;
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
