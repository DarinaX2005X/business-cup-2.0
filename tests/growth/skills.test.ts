import { describe, expect, it } from 'vitest';
import type { ProfileSkills } from '@/domain/types';
import type { ProfileSkillsOutput } from '@/server/ai/prompts/profile-skills';
import { onetById } from '@/server/growth/onet';
import {
  applyRead,
  cleanText,
  computeGaps,
  elementsToCheck,
  findQuote,
  patchSkills,
  skillIdFor,
  verifyRead,
  type BundleLike,
  type RelatedLike,
} from '@/server/growth/skills';
import { matchTechnology, technologiesFor, type Technology } from '@/server/growth/technology';

const RESUME = cleanText(`Jane Rivera, RN
Charge Nurse, St. Mary's Medical Center, 2017 – present
• Triaged 30+ patients per shift in a Level II emergency department.
• Educated patients and families on discharge plans and new medications.
• Documented assessments in Epic; trained 6 new graduate nurses as a preceptor.
Skills: IV therapy, wound care, Microsoft Excel`);

const NURSE: BundleLike = {
  code: '29-1141.00',
  title: 'Registered Nurses',
  skills: [
    { id: '2.B.1.a', name: 'Social Perceptiveness', importance: 4.12 },
    { id: '2.A.1.b', name: 'Active Listening', importance: 4 },
    { id: '2.B.1.e', name: 'Instructing', importance: 3.5 },
    { id: '2.B.4.e', name: 'Judgment and Decision Making', importance: 3.88 },
  ],
  knowledge: [
    { id: '2.C.5.a', name: 'Medicine and Dentistry', importance: 4.36 },
    { id: '2.C.7.a', name: 'English Language', importance: 4.18 },
    { id: '2.C.4.e', name: 'Psychology', importance: 4.58 },
  ],
};
const RELATED: RelatedLike = [
  { code: '29-1171.00', slug: 'nurse-practitioners', title: 'Nurse Practitioners', similarity: 0.92, typicalHumanShare: 0.7, wageDelta: 34750, missingSkills: ['Biology', 'Science'] },
  { code: '29-1071.00', slug: 'physician-assistants', title: 'Physician Assistants', similarity: 0.9, typicalHumanShare: 0.88, wageDelta: 38330, missingSkills: ['Biology', 'Education and Training'] },
];
const TECHS: Technology[] = [
  { name: 'Epic Systems', hot: true, inDemand: false },
  { name: 'Microsoft Excel', hot: true, inDemand: true },
  { name: 'MEDITECH software', hot: true, inDemand: true },
];

describe('findQuote', () => {
  it('returns the excerpt from the text itself, ignoring case, curly quotes and spacing', () => {
    expect(findQuote(RESUME, 'triaged 30+ patients per shift')).toBe('Triaged 30+ patients per shift');
    expect(findQuote(RESUME, '“Educated patients and  families on discharge plans.”')).toBe('Educated patients and families on discharge plans');
    expect(findQuote(RESUME, "St Mary's")).toBeNull();
  });

  it('refuses paraphrases and quotes stitched together with an ellipsis', () => {
    expect(findQuote(RESUME, 'Taught patients about discharge')).toBeNull();
    expect(findQuote(RESUME, 'Triaged 30+ patients ... Level II')).toBeNull();
  });
});

function output(over: Partial<ProfileSkillsOutput> = {}): ProfileSkillsOutput {
  return {
    isWorkText: true,
    seniorityYears: 8,
    skills: [
      { name: 'Patient triage', kind: 'skill', onetId: '2.B.4.e', years: 8, quotes: ['Triaged 30+ patients per shift in a Level II emergency department'] },
      { name: 'Epic', kind: 'tool', onetId: null, years: null, quotes: ['Documented assessments in Epic'] },
      { name: 'Precepting', kind: 'skill', onetId: '9.9.9', years: 40, quotes: ['trained 6 new graduate nurses as a preceptor'] },
      { name: 'Leadership', kind: 'skill', onetId: null, years: null, quotes: ['Led the hospital through a merger'] },
      { name: 'patient  triage', kind: 'skill', onetId: null, years: null, quotes: ['Triaged 30+ patients'] },
    ],
    shown: [
      { onetId: '2.B.1.e', quote: 'Educated patients and families on discharge plans' },
      { onetId: '2.B.1.a', quote: 'Read every patient like a book' },
      { onetId: '1.A.1', quote: 'Triaged 30+ patients' },
    ],
    ...over,
  };
}

describe('verifyRead', () => {
  const elements = elementsToCheck(NURSE, RELATED);

  it('keeps only skills whose quotes are in the text, and only ids that were asked about', () => {
    const read = verifyRead(output(), RESUME, elements, TECHS);
    expect(read.items.map((i) => i.name)).toEqual(['Patient triage', 'Epic', 'Precepting']);
    expect(read.dropped).toEqual(
      expect.arrayContaining([
        { name: 'Leadership', why: 'no_quote' },
        { name: 'patient triage', why: 'duplicate' },
      ]),
    );
    const precept = read.items.find((i) => i.name === 'Precepting')!;
    expect(precept.onetId).toBeNull(); // 9.9.9 is not an element we sent
    expect(precept.years).toBeNull(); // 40 years with 8 years of work is not plausible
    expect(read.items[0].onetId).toBe('2.B.4.e');
    expect(read.items[0].id).toBe(skillIdFor('Patient triage'));
  });

  it('maps tools to the job\'s O*NET technologies', () => {
    const read = verifyRead(output(), RESUME, elements, TECHS);
    expect(read.items.find((i) => i.name === 'Epic')!.tech).toBe('Epic Systems');
  });

  it('keeps shown elements with a real quote only', () => {
    const read = verifyRead(output(), RESUME, elements, TECHS);
    expect(read.shown).toEqual([{ onetId: '2.B.1.e', quote: 'Educated patients and families on discharge plans' }]);
    expect(read.checked).toContain('2.C.4.d'); // Biology, from the jobs next door
  });
});

describe('applyRead and patchSkills', () => {
  const now = '2026-11-15T10:00:00.000Z';
  const read = verifyRead(output(), RESUME, elementsToCheck(NURSE, RELATED), TECHS);

  it('a new read keeps what the person added or kept and never brings back a removed skill', () => {
    let skills: ProfileSkills = applyRead(undefined, read, { occupationCode: NURSE.code, textHash: 'h1', now });
    expect(skills.items.every((i) => i.source === 'resume')).toBe(true);

    const triage = skills.items.find((i) => i.name === 'Patient triage')!;
    skills = patchSkills(skills, { op: 'confirm', id: triage.id }, { now, techs: TECHS }).skills;
    const epic = skills.items.find((i) => i.name === 'Epic')!;
    skills = patchSkills(skills, { op: 'remove', id: epic.id }, { now, techs: TECHS }).skills;
    skills = patchSkills(skills, { op: 'add', name: 'wound care' }, { now, techs: TECHS }).skills;

    const again = applyRead(skills, read, { occupationCode: NURSE.code, textHash: 'h2', now });
    expect(again.items.find((i) => i.name === 'Patient triage')!.source).toBe('confirmed');
    expect(again.items.some((i) => i.name === 'Epic')).toBe(false);
    expect(again.items.find((i) => i.name === 'wound care')!.source).toBe('added');
    expect(again.textHash).toBe('h2');

    const restored = patchSkills(again, { op: 'restore', id: epic.id }, { now, techs: TECHS }).skills;
    expect(restored.items.some((i) => i.name === 'Epic')).toBe(true);
    expect(restored.removed).toHaveLength(0);
  });

  it('a typed skill is matched to an O*NET element or a technology', () => {
    const a = patchSkills(undefined, { op: 'add', name: 'teaching others' }, { now, techs: TECHS });
    expect(a.item).toMatchObject({ onetId: '2.B.1.e', kind: 'skill', source: 'added', name: 'Teaching others' });
    const b = patchSkills(undefined, { op: 'add', name: 'excel' }, { now, techs: TECHS });
    expect(b.item).toMatchObject({ tech: 'Microsoft Excel', kind: 'tool' });
    expect(() => patchSkills(undefined, { op: 'add', name: ' x ' }, { now, techs: TECHS })).toThrow(/at least two letters/);
  });
});

describe('computeGaps', () => {
  const now = '2026-11-15T10:00:00.000Z';
  const read = verifyRead(output(), RESUME, elementsToCheck(NURSE, RELATED), TECHS);
  const skills = applyRead(undefined, read, { occupationCode: NURSE.code, textHash: 'h', now });

  it('names important skills of their job the résumé does not show, never English or what they show', () => {
    const gaps = computeGaps({ bundle: NURSE, related: RELATED, techs: TECHS, skills });
    const own = gaps.filter((g) => g.reason === 'own_job').map((g) => g.id);
    expect(own).toEqual(['2.C.4.e', '2.C.5.a']); // Psychology 4.58, Medicine 4.36
    expect(gaps.some((g) => g.id === '2.C.7.a')).toBe(false); // English Language
    expect(gaps.some((g) => g.id === '2.B.1.e')).toBe(false); // shown in the résumé
    expect(gaps.some((g) => g.id === '2.B.4.e')).toBe(false); // their triage skill counts toward it
  });

  it('says which next jobs a gap opens and adds one in-demand tool they do not list', () => {
    const gaps = computeGaps({ bundle: NURSE, related: RELATED, techs: TECHS, skills });
    const bio = gaps.find((g) => g.id === '2.C.4.d')!;
    expect(bio.reason).toBe('next_job');
    expect(bio.leadsTo.map((j) => j.slug)).toEqual(['nurse-practitioners', 'physician-assistants']);
    const tools = gaps.filter((g) => g.reason === 'in_demand').map((g) => g.name);
    expect(tools).toEqual(['Microsoft Excel']); // they list Excel only as a resume skill line, not as an item
    expect(gaps.length).toBeLessThanOrEqual(5);
  });

  it('counts a listed tool as covered', () => {
    const withExcel = patchSkills(skills, { op: 'add', name: 'Excel' }, { now, techs: TECHS }).skills;
    const gaps = computeGaps({ bundle: NURSE, related: RELATED, techs: TECHS, skills: withExcel });
    expect(gaps.filter((g) => g.reason === 'in_demand').map((g) => g.name)).toEqual(['MEDITECH software']);
  });
});

describe('technologies', () => {
  it('reads the O*NET list of an occupation', () => {
    const dev = technologiesFor('15-1252.00');
    expect(dev.find((t) => t.name === 'Python')).toMatchObject({ inDemand: true });
    expect(technologiesFor('00-0000.00')).toEqual([]);
  });

  it('matches short names without mixing up C and C#', () => {
    const dev = technologiesFor('15-1252.00');
    expect(matchTechnology('AWS', dev)?.name).toBe('Amazon Web Services AWS software');
    expect(matchTechnology('C#', dev)?.name).toBe('C#');
    expect(matchTechnology('C', dev)?.name).toBe('C');
    expect(matchTechnology('Kubernetes', dev)?.name).toBe('Kubernetes');
    expect(matchTechnology('Juggling', dev)).toBeNull();
  });

  it('every O*NET element the bundles use is known', () => {
    for (const id of ['2.B.3.e', '2.C.6', '2.C.10', '2.B.5.d']) expect(onetById(id)).toBeDefined();
  });
});
