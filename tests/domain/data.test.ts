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
      ['AEI observed: work use and >= 0.01% of conversations', p(c.aeiObservedWorkGated)],
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
    expect(c.aeiObservedWorkGated).toBeCloseTo(0.065, 3); // work-gated AND >= 0.01% of a source's conversations
    expect(c.aeiEverObserved).toBeCloseTo(0.313, 3);
    expect(c.evidenceLevels.observed + c.evidenceLevels.estimate + c.evidenceLevels.none).toBe(18838);
  });

  it('records the formula constants, every raw file hash and the attribution', () => {
    expect(meta.constants.THEORY_WEIGHT).toBe(0.5);
    expect(meta.constants.WORK_GATE).toBe(0.5);
    expect(meta.constants.AT_STAKE_AI_DOES).toBe(1);
    expect(meta.constants.AT_STAKE_AI_SPEEDS).toBe(0.5);
    expect(meta.constants.aiDoesAutomation).toBe(0.7);
    expect(meta.constants.minObservedShare).toBe(0.0001);
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
const relatedFile = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'related.json'), 'utf8')) as Record<string, OccupationBundle['related']>;

describe('task evidence on real occupations', () => {
  it('registered nurse: E2-only tasks nobody uses AI for stay human; bedside monitoring is never handed to AI', () => {
    const rn = bundleOf('29-1141.00');
    // Record patients' medical information: E2 by both raters, not seen in AI work use → stays with you for now.
    expect(byId(rn, '1841').evidence).toMatchObject({ theory: 0.5, observed: false, category: 'human_edge' });
    expect(byId(rn, '20413').evidence.category).toBe('human_edge'); // Administer medications (physical, E0)
    expect(byId(rn, '1855').evidence.category).toBe('human_edge'); // Provide health care, first aid
    expect(byId(rn, '1846').evidence.category).toBe('human_edge'); // Direct or supervise nursing personnel (people work)
    // Monitor, record, report symptoms: work use published but below 0.01% (93% of it API traffic): seen rarely,
    // so the research rating decides, never "AI already does it".
    expect(byId(rn, '1840').evidence).toMatchObject({ observed: false, seenRarely: true, evidenceLevel: 'estimate' });
    expect(byId(rn, '1840').evidence.category).not.toBe('ai_does');
  });

  it('LPN: answering patients calls is not "AI already does it"', () => {
    expect(byId(bundleOf('29-2061.00'), '509').evidence).toMatchObject({ seenRarely: true, category: 'human_edge' });
  });

  it('accountant: observed record work is ai_speeds; reconciliation rated E0 / E2 stays human', () => {
    const acc = bundleOf('13-2011.00');
    expect(byId(acc, '21514').evidence).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'observed' });
    expect(byId(acc, '21516').evidence).toMatchObject({ theorySource: 'human+gpt4', theory: 0.25, category: 'human_edge' });
  });

  it('bookkeeping clerks: observed checking work is ai_speeds, coding documents is ai_does', () => {
    const bk = bundleOf('43-3031.00');
    expect(byId(bk, '2486').evidence).toMatchObject({ category: 'ai_speeds', evidenceLevel: 'observed' }); // Check figures, postings
    // Operate computers with accounting software: E0 / E1 (theory 0.5) and not seen in use → stays human for now.
    expect(byId(bk, '2487').evidence.category).toBe('human_edge');
    expect(bk.tasks.filter((t) => t.evidence.category === 'ai_does').length).toBeGreaterThan(0);
  });

  it('electrician: installation is human_edge through the physical flag', () => {
    const el = bundleOf('47-2111.00');
    for (const id of ['2888', '2873', '2875']) expect(byId(el, id).evidence).toMatchObject({ physical: true, category: 'human_edge' });
  });

  it('E1 writing tasks are not held back by a physical flag', () => {
    for (const [code, id] of [['11-9031.00', '5206'], ['11-9032.00', '5230']]) {
      expect(byId(bundleOf(code), id).evidence.category, `${code} ${id}`).toBe('ai_speeds');
    }
  });

  it('category distributions and base scores (fixed so a data change is visible in review)', () => {
    const rows = ['29-1141.00', '29-2061.00', '29-1141.03', '13-2011.00', '43-3031.00', '47-2111.00', '43-4051.00'].map((c) => ({ c, d: dist(c), base: xrayOf(c).baseScore }));
    console.log(rows.map((r) => `${r.c} ${JSON.stringify(r.d)} base ${r.base}`).join('\n'));
    expect(dist('29-1141.00')).toEqual({ ai_speeds: 6, human_edge: 21 });
    expect(dist('29-2061.00')).toEqual({ ai_speeds: 3, human_edge: 19 });
    expect(dist('29-1141.01')).toEqual({ ai_does: 1, ai_speeds: 5, human_edge: 21 });
    expect(dist('29-1141.03')).toEqual({ ai_speeds: 5, human_edge: 24 });
    expect(dist('13-2011.00')).toEqual({ ai_speeds: 13, human_edge: 17 });
    expect(dist('43-3031.00')).toEqual({ ai_does: 2, ai_speeds: 16, human_edge: 10 });
    expect(dist('47-2111.00')).toEqual({ ai_speeds: 2, human_edge: 19 });
    expect(dist('43-4051.00')).toEqual({ ai_does: 4, ai_speeds: 5, human_edge: 4 });
    // Similar nursing jobs land close together (the jury's "compare two similar jobs").
    const human = (c: string) => xrayOf(c).percent.human_edge;
    expect(Math.abs(human('29-1141.00') - human('29-1141.01'))).toBeLessThan(20);
    expect(Math.abs(human('29-1141.00') - human('29-1141.03'))).toBeLessThan(20);
    // Air traffic control: radar and pilot communication are not "AI speeds it up".
    const atc = bundleOf('53-2021.00');
    const control = atc.tasks.filter((x) => /^(Inform pilots|Monitor aircraft|Direct pilots|Contact pilots)/.test(x.text));
    expect(control.length).toBeGreaterThan(2);
    for (const t of control) expect(t.evidence.category, t.text).toBe('human_edge');
    // Elementary teachers: observing students stays human.
    expect(byId(bundleOf('25-2021.00'), '6536').evidence.category).toBe('human_edge');
    expect(xrayOf('43-3031.00').baseScore).toBeLessThanOrEqual(xrayOf('13-2011.00').baseScore);
  });

  it('every ai_does task has meaningful volume and high automation from a trusted basis', () => {
    for (const e of index) {
      for (const t of bundleOf(e.code).tasks) {
        const v = t.evidence;
        if (v.category !== 'ai_does') continue;
        expect(v.observed).toBe(true);
        expect(v.automationBasis === 'claude_ai' || (v.automationBasis === '1p_api' && v.theory >= 0.75)).toBe(true);
      }
    }
  });

  it('every task has a short label of at most 4 words, never a dangling fragment', () => {
    for (const e of [...index].sort((a, b) => a.rank - b.rank).slice(0, 600)) {
      for (const t of bundleOf(e.code).tasks) {
        expect(t.short, t.id).toBeTruthy();
        expect(t.short!.split(' ').length, `${t.id} ${t.short}`).toBeLessThanOrEqual(4);
        expect(t.short, `${t.id} ${t.short}`).not.toMatch(/[.,;:]$|\b(related|accurate|and|or|of|to|for|the)$/i);
      }
    }
  });
});

describe('similar professions: near-identical tasks get the same category', () => {
  const STOP = new Set(['and', 'or', 'the', 'of', 'to', 'for', 'in', 'a', 'such', 'as', 'with', 'on', 'by', 'patients', 'patient']);
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let i = 0;
    for (const x of a) if (b.has(x)) i++;
    return i / (a.size + b.size - i);
  };
  it('Registered Nurses vs Licensed Practical Nurses', () => {
    const rn = bundleOf('29-1141.00');
    const lpn = bundleOf('29-2061.00');
    const pairs: [string, string, string, string][] = [];
    for (const a of rn.tasks) {
      for (const b of lpn.tasks) {
        const sameDwas = a.dwaIds.length > 0 && a.dwaIds.join() === b.dwaIds.join();
        if ((jaccard(words(a.text), words(b.text)) >= 0.4 || sameDwas) && a.evidence.theory === b.evidence.theory) {
          pairs.push([a.text.slice(0, 50), b.text.slice(0, 50), a.evidence.category, b.evidence.category]);
        }
      }
    }
    console.log(pairs.map((p) => `${p[2]} / ${p[3]}: ${p[0]} | ${p[1]}`).join('\n'));
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b, ca, cb] of pairs) expect(ca, `${a} | ${b}`).toBe(cb);
    // The weeks differ because the task lists differ (RNs record, coordinate and plan more), not by rule noise.
    expect(Math.abs(xrayOf('29-1141.00').percent.human_edge - xrayOf('29-2061.00').percent.human_edge)).toBeLessThan(40);
  });
});

describe('neighbouring occupations', () => {
  const codesOf = (code: string) => relatedFile[code].map((r) => r.code);
  const titlesOf = (code: string) => relatedFile[code].map((r) => r.title);

  it('public bundles carry only the first neighbour; the full list is server-only', () => {
    for (const e of index) {
      const b = bundleOf(e.code);
      expect(b.related.length).toBeLessThanOrEqual(1);
      expect(b.relatedCount).toBe(relatedFile[e.code].length);
      if (b.related.length) expect(b.related[0]).toEqual(relatedFile[e.code][0]);
    }
  });

  it('neighbours are similar, about as safe or safer, same or next Job Zone, and pay about as much or more', () => {
    const zone = new Map(index.map((e) => [e.code, e.jobZone]));
    const share = new Map(index.map((e) => [e.code, e.typicalHumanShare]));
    let filled = 0;
    let lowerPaid = 0;
    for (const e of index) {
      const list = relatedFile[e.code];
      if (list.length) filled++;
      const wage = bundleOf(e.code).wage.medianAnnual;
      for (const r of list) {
        const z = zone.get(r.code)!;
        if (e.jobZone !== null && z !== null) expect(z - e.jobZone).toBeGreaterThanOrEqual(0);
        expect(share.get(r.code)! - e.typicalHumanShare).toBeGreaterThanOrEqual(-0.05 - 1e-9);
        expect(r.similarity).toBeGreaterThanOrEqual(0.7);
        if (wage && r.wageDelta !== null && r.wageDelta < -0.05 * wage) lowerPaid++;
      }
      // lower-paid moves appear only when nothing else qualifies
      if (list.some((r) => wage && r.wageDelta !== null && r.wageDelta < -0.05 * wage)) {
        expect(list.every((r) => wage && r.wageDelta !== null && r.wageDelta < -0.05 * wage)).toBe(true);
      }
    }
    console.log(`neighbours filled ${filled}/${index.length}, lower-paid entries ${lowerPaid}`);
    expect(filled / index.length).toBeGreaterThan(0.85);
  });

  it('registered nurse: nursing roles first, no physicians or psychologists in the top 3', () => {
    const rel = codesOf('29-1141.00');
    const top3 = titlesOf('29-1141.00').slice(0, 3);
    expect(rel).toContain('29-1171.00'); // Nurse Practitioners
    expect(top3.every((t) => /Nurse/.test(t)), top3.join(', ')).toBe(true);
    expect(top3.some((t) => /Physician|Psycholog|Surgeon/.test(t))).toBe(false);
  });

  it('customer service: customer-facing office roles, no gambling dealers or ushers', () => {
    const rel = codesOf('43-4051.00');
    expect(rel.filter((c) => c.startsWith('43-')).length).toBeGreaterThanOrEqual(5);
    expect(rel).not.toContain('39-3011.00');
    expect(rel).not.toContain('39-3031.00');
  });

  it('bookkeeping clerk is not offered a pay cut when a better move exists', () => {
    const bk = relatedFile['43-3031.00'];
    expect(bk.map((r) => r.code)).toContain('13-2011.00');
    const wage = bundleOf('43-3031.00').wage.medianAnnual!;
    expect(bk.every((r) => (r.wageDelta ?? 0) >= -0.05 * wage)).toBe(true); // comparable pay or better
  });

  it('skill gaps list only skills that matter in the target', () => {
    const vfx = relatedFile['27-1024.00'].find((r) => r.code === '27-1014.00');
    if (vfx) expect(vfx.missingSkills).not.toContain('Geography');
    for (const e of index) for (const r of relatedFile[e.code]) expect(new Set(r.missingSkills).size).toBe(r.missingSkills.length);
  });

  it('neighbours carry wage difference and missing skills', () => {
    const r = relatedFile['13-2011.00'].find((x) => x.code === '11-3031.01')!;
    expect(r.wageDelta).toBeGreaterThan(0);
    expect(r.missingSkills.length).toBeGreaterThan(0);
  });
});

describe('validation against published measures', () => {
  it('Spearman against Anthropic and Microsoft is recorded and positive', () => {
    console.log(meta.validation.map((v: { id: string; rho: number; n: number }) => `${v.id} rho ${v.rho} n ${v.n}`).join('; '));
    expect(meta.validation.map((v: { id: string }) => v.id)).toEqual(['anthropic', 'microsoft']);
    for (const v of meta.validation) {
      expect(v.rho).toBeGreaterThan(0.5);
      expect(v.n).toBeGreaterThan(700);
    }
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
