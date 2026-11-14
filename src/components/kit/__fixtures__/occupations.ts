/*
 * Temporary fixture bundles for the gallery, shaped like OccupationBundle.
 * Task statements are O*NET 31.0 wording; the evidence numbers are illustrative placeholders
 * until 01.1 writes real bundles to tests/fixtures/occupations/. Never shown outside /dev.
 */

import type { OccTask, OccupationBundle, TaskEvidence, WeekShare } from '../types';

type Ev = Partial<TaskEvidence> & Pick<TaskEvidence, 'category' | 'evidenceLevel'>;

function ev(e: Ev): TaskEvidence {
  return {
    theoryLabel: null,
    theorySource: null,
    theory: 0,
    observed: e.evidenceLevel === 'observed',
    everObserved: e.evidenceLevel === 'observed',
    aeiShare: null,
    aeiSource: null,
    aeiAutomation: null,
    aeiWorkShare: null,
    penetration: null,
    history: null,
    physical: null,
    exposure: 0,
    ...e,
  };
}

function task(id: string, text: string, importance: number, frequency: number | null, e: Ev): OccTask {
  return { id, text, importance, relevance: 100, frequency, core: true, dwaIds: [], evidence: ev(e) };
}

const dataVersion = { onet: '31.0', aei: '2026-06-26', gpts: '2023-08', ms: '2025-07', bls: 'May 2025' } as const;

export const nurse: OccupationBundle = {
  code: '29-1141.00',
  slug: 'registered-nurses',
  title: 'Registered Nurses',
  description:
    'Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records.',
  jobZone: 3,
  wage: { medianAnnual: 93600, employment: 3282010, sharedWith: 4, soc: '29-1141', note: null, source: 'BLS OEWS May 2025' },
  tasks: [
    task('rn-01', 'Maintain accurate, detailed reports and records.', 4.6, 6.4, {
      category: 'ai_does', evidenceLevel: 'observed', theoryLabel: 'E1', theorySource: 'human', theory: 0.5,
      aeiShare: 0.0042, aeiAutomation: 0.71, exposure: 0.79,
    }),
    task('rn-02', 'Record patients’ medical information and vital signs.', 4.5, 6.6, {
      category: 'ai_does', evidenceLevel: 'observed', theoryLabel: 'E1', theorySource: 'human', theory: 0.5,
      aeiShare: 0.0011, aeiAutomation: 0.58, exposure: 0.69,
    }),
    task('rn-03', 'Administer medications to patients and monitor patients for reactions or side effects.', 4.8, 6.5, {
      category: 'ai_speeds', evidenceLevel: 'estimate', theoryLabel: 'E1', theorySource: 'gpt4', theory: 0.5, physical: true, exposure: 0.25,
    }),
    task('rn-04', 'Instruct individuals, families, or other groups on topics such as health education, disease prevention, or childbirth and develop health improvement programs.', 3.9, 5.1, {
      category: 'ai_speeds', evidenceLevel: 'observed', theoryLabel: 'E1', theorySource: 'human', theory: 0.5,
      aeiShare: 0.0006, aeiAutomation: 0.22, exposure: 0.55,
    }),
    task('rn-05', 'Monitor, record, and report symptoms or changes in patients’ conditions.', 4.9, 6.8, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'human', theory: 0, physical: true, exposure: 0.05,
    }),
    task('rn-06', 'Prepare patients for and assist with examinations or treatments.', 4.3, 6.2, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'human', theory: 0, physical: true, exposure: 0,
    }),
    task('rn-07', 'Consult and coordinate with healthcare team members to assess, plan, implement, or evaluate patient care plans.', 4.4, 5.8, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'gpt4', theory: 0, exposure: 0.1,
    }),
    task('rn-08', 'Direct or supervise less-skilled nursing or healthcare personnel or supervise a particular unit.', 3.8, 4.9, {
      category: 'no_data', evidenceLevel: 'none', exposure: 0,
    }),
  ],
  skills: [
    { id: '2.A.1.a', name: 'Active Listening', importance: 4.4 },
    { id: '2.B.1.b', name: 'Social Perceptiveness', importance: 4.3 },
  ],
  knowledge: [{ id: '2.C.8.b', name: 'Medicine and Dentistry', importance: 4.6 }],
  typicalHumanShare: 0.44,
  related: [],
  dataVersion,
};

export const electrician: OccupationBundle = {
  code: '47-2111.00',
  slug: 'electricians',
  title: 'Electricians',
  description:
    'Install, maintain, and repair electrical wiring, equipment, and fixtures. Ensure that work is in accordance with relevant codes.',
  jobZone: 3,
  wage: { medianAnnual: 62350, employment: 779800, sharedWith: 1, soc: '47-2111', note: null, source: 'BLS OEWS May 2025' },
  tasks: [
    task('el-01', 'Prepare sketches or follow blueprints to determine the location of wiring or equipment and to ensure conformance to building and safety codes.', 4.1, 5.2, {
      category: 'ai_speeds', evidenceLevel: 'observed', theoryLabel: 'E1', theorySource: 'human', theory: 0.5,
      aeiShare: 0.00031, aeiAutomation: 0.34, exposure: 0.58,
    }),
    task('el-02', 'Plan layout and installation of electrical wiring, equipment, or fixtures, based on job specifications and local codes.', 4.5, 5.6, {
      category: 'ai_speeds', evidenceLevel: 'estimate', theoryLabel: 'E1', theorySource: 'gpt4', theory: 0.5, exposure: 0.25,
    }),
    task('el-03', 'Advise management on whether continued operation of equipment could be hazardous.', 3.9, 3.8, {
      category: 'ai_does', evidenceLevel: 'observed', theoryLabel: 'E1', theorySource: 'human', theory: 0.5,
      aeiShare: 0.000048, aeiAutomation: 0.82, exposure: 0.66,
    }),
    task('el-04', 'Connect wires to circuit breakers, transformers, or other components.', 4.7, 6.3, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'human', theory: 0, physical: true, exposure: 0,
    }),
    task('el-05', 'Test electrical systems or continuity of circuits in electrical wiring, equipment, or fixtures, using testing devices, such as ohmmeters, voltmeters, or oscilloscopes, to ensure compatibility and safety of system.', 4.7, 6.0, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'human', theory: 0, physical: true, exposure: 0.04,
    }),
    task('el-06', 'Inspect electrical systems, equipment, or components to identify hazards, defects, or the need for adjustment or repair, and to ensure compliance with codes.', 4.6, 5.9, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'gpt4', theory: 0, physical: true, exposure: 0.08,
    }),
    task('el-07', 'Install ground leads and connect power cables to equipment, such as motors.', 4.4, 5.4, {
      category: 'human_edge', evidenceLevel: 'estimate', theoryLabel: 'E0', theorySource: 'human', theory: 0, physical: true, exposure: 0,
    }),
    task('el-08', 'Maintain current electrician’s license or identification card to meet governmental regulations.', 3.6, 2.1, {
      category: 'no_data', evidenceLevel: 'none', exposure: 0,
    }),
  ],
  skills: [{ id: '2.B.3.b', name: 'Troubleshooting', importance: 4.2 }],
  knowledge: [{ id: '2.C.3.e', name: 'Building and Construction', importance: 4.1 }],
  typicalHumanShare: 0.61,
  related: [],
  dataVersion,
};

/** Short labels as `/api/occupations/:code/texts` would return them. */
export const shortLabels: Record<string, string> = {
  'rn-01': 'Charting',
  'rn-02': 'Vital signs',
  'rn-03': 'Medications',
  'rn-04': 'Patient education',
  'rn-05': 'Bedside assessment',
  'rn-06': 'Exams and treatments',
  'rn-07': 'Care team planning',
  'rn-08': 'Supervising staff',
  'el-01': 'Blueprints and sketches',
  'el-02': 'Layout planning',
  'el-03': 'Hazard advice',
  'el-04': 'Connecting wiring',
  'el-05': 'Circuit testing',
  'el-06': 'Code inspection',
  'el-07': 'Grounding and power',
  'el-08': 'Licensing',
};

export const nurseShares: WeekShare[] = [
  { taskId: 'rn-01', share: 15 },
  { taskId: 'rn-02', share: 9 },
  { taskId: 'rn-03', share: 16 },
  { taskId: 'rn-04', share: 12 },
  { taskId: 'rn-05', share: 23 },
  { taskId: 'rn-06', share: 14 },
  { taskId: 'rn-07', share: 7 },
  { taskId: 'rn-08', share: 4 },
];

export const electricianShares: WeekShare[] = [
  { taskId: 'el-01', share: 10 },
  { taskId: 'el-02', share: 14 },
  { taskId: 'el-03', share: 4 },
  { taskId: 'el-04', share: 24 },
  { taskId: 'el-05', share: 17 },
  { taskId: 'el-06', share: 13 },
  { taskId: 'el-07', share: 15 },
  { taskId: 'el-08', share: 3 },
];
