import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEvidence, type EvidenceInput } from '@/domain/evidence';
import type { OccTask, OccupationBundle } from '@/domain/types';

export const ROOT = join(__dirname, '..', '..');

export function fixture(code: string): OccupationBundle {
  return JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'occupations', `${code}.json`), 'utf8')) as OccupationBundle;
}

const base: EvidenceInput = {
  theoryLabel: 'E2',
  gpt4Label: null,
  theorySource: 'human',
  theory: 0.5,
  observed: false,
  everObserved: false,
  aeiShare: null,
  aeiSource: null,
  aeiAutomation: null,
  aeiWorkShare: null,
  penetration: null,
  history: null,
  physical: false,
};

export function evidence(over: Partial<EvidenceInput> = {}) {
  return buildEvidence({ ...base, ...over });
}

/** Evidence presets for each category. */
export const preset = {
  ai_does: () => evidence({ theoryLabel: 'E1', theory: 1, observed: true, aeiShare: 0.004, aeiSource: 'claude_ai', aeiAutomation: 0.8, aeiWorkShare: 0.9 }),
  ai_speeds: () => evidence({ theoryLabel: 'E2', theory: 0.5 }),
  human_edge: () => evidence({ theoryLabel: 'E0', theory: 0 }),
  no_data: () => evidence({ theoryLabel: null, theorySource: null, theory: null }),
};

export function task(id: string, cat: keyof typeof preset, over: Partial<OccTask> = {}): OccTask {
  return { id, text: `Task ${id}`, importance: 4, relevance: 80, frequency: 4, core: true, dwaIds: [], evidence: preset[cat](), ...over };
}

export function bundle(tasks: OccTask[], medianAnnual: number | null = 60000): OccupationBundle {
  return {
    code: '00-0000.00',
    slug: 'test',
    title: 'Test',
    description: '',
    jobZone: 3,
    wage: { medianAnnual, employment: 1000, sharedWith: 1, soc: '00-0000', note: null, source: 'BLS OEWS May 2025' },
    tasks,
    skills: [],
    knowledge: [],
    typicalHumanShare: 0,
    related: [],
    dataVersion: { onet: '31.0', aei: '2026-06-26', gpts: 'x', ms: 'x', bls: 'May 2025' },
  };
}
