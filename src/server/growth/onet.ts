/**
 * O*NET 31.0 skills (35) and knowledge areas (33) with their element ids, as published in the
 * Content Model Reference. Occupation bundles carry the top ten of each with importance; this list lets
 * the growth code name any element, read related jobs' `missingSkills` (names) back into ids, and check
 * that the model only returns ids that exist. Plain-English labels live in `skills.en.json` → `onet.<key>`.
 */

export type OnetKind = 'skill' | 'knowledge';

export interface OnetElement {
  id: string;
  name: string;
  kind: OnetKind;
}

const S = (id: string, name: string): OnetElement => ({ id, name, kind: 'skill' });
const K = (id: string, name: string): OnetElement => ({ id, name, kind: 'knowledge' });

export const ONET_ELEMENTS: readonly OnetElement[] = [
  S('2.A.1.a', 'Reading Comprehension'),
  S('2.A.1.b', 'Active Listening'),
  S('2.A.1.c', 'Writing'),
  S('2.A.1.d', 'Speaking'),
  S('2.A.1.e', 'Mathematics'),
  S('2.A.1.f', 'Science'),
  S('2.A.2.a', 'Critical Thinking'),
  S('2.A.2.b', 'Active Learning'),
  S('2.A.2.c', 'Learning Strategies'),
  S('2.A.2.d', 'Monitoring'),
  S('2.B.1.a', 'Social Perceptiveness'),
  S('2.B.1.b', 'Coordination'),
  S('2.B.1.c', 'Persuasion'),
  S('2.B.1.d', 'Negotiation'),
  S('2.B.1.e', 'Instructing'),
  S('2.B.1.f', 'Service Orientation'),
  S('2.B.2.i', 'Complex Problem Solving'),
  S('2.B.3.a', 'Operations Analysis'),
  S('2.B.3.b', 'Technology Design'),
  S('2.B.3.c', 'Equipment Selection'),
  S('2.B.3.d', 'Installation'),
  S('2.B.3.e', 'Programming'),
  S('2.B.3.g', 'Operations Monitoring'),
  S('2.B.3.h', 'Operation and Control'),
  S('2.B.3.j', 'Equipment Maintenance'),
  S('2.B.3.k', 'Troubleshooting'),
  S('2.B.3.l', 'Repairing'),
  S('2.B.3.m', 'Quality Control Analysis'),
  S('2.B.4.e', 'Judgment and Decision Making'),
  S('2.B.4.g', 'Systems Analysis'),
  S('2.B.4.h', 'Systems Evaluation'),
  S('2.B.5.a', 'Time Management'),
  S('2.B.5.b', 'Management of Financial Resources'),
  S('2.B.5.c', 'Management of Material Resources'),
  S('2.B.5.d', 'Management of Personnel Resources'),
  K('2.C.1.a', 'Administration and Management'),
  K('2.C.1.b', 'Administrative'),
  K('2.C.1.c', 'Economics and Accounting'),
  K('2.C.1.d', 'Sales and Marketing'),
  K('2.C.1.e', 'Customer and Personal Service'),
  K('2.C.1.f', 'Personnel and Human Resources'),
  K('2.C.2.a', 'Production and Processing'),
  K('2.C.2.b', 'Food Production'),
  K('2.C.3.a', 'Computers and Electronics'),
  K('2.C.3.b', 'Engineering and Technology'),
  K('2.C.3.c', 'Design'),
  K('2.C.3.d', 'Building and Construction'),
  K('2.C.3.e', 'Mechanical'),
  K('2.C.4.a', 'Mathematics'),
  K('2.C.4.b', 'Physics'),
  K('2.C.4.c', 'Chemistry'),
  K('2.C.4.d', 'Biology'),
  K('2.C.4.e', 'Psychology'),
  K('2.C.4.f', 'Sociology and Anthropology'),
  K('2.C.4.g', 'Geography'),
  K('2.C.5.a', 'Medicine and Dentistry'),
  K('2.C.5.b', 'Therapy and Counseling'),
  K('2.C.6', 'Education and Training'),
  K('2.C.7.a', 'English Language'),
  K('2.C.7.b', 'Foreign Language'),
  K('2.C.7.c', 'Fine Arts'),
  K('2.C.7.d', 'History and Archeology'),
  K('2.C.7.e', 'Philosophy and Theology'),
  K('2.C.8.a', 'Public Safety and Security'),
  K('2.C.8.b', 'Law and Government'),
  K('2.C.9.a', 'Telecommunications'),
  K('2.C.9.b', 'Communications and Media'),
  K('2.C.10', 'Transportation'),
];

const BY_ID = new Map(ONET_ELEMENTS.map((e) => [e.id, e]));

export const onetById = (id: string): OnetElement | undefined => BY_ID.get(id);

/** i18n key part for an element id: `2.B.1.e` → `2_B_1_e` (dots would split the dictionary path). */
export const onetKey = (id: string) => id.replace(/\./g, '_');

/**
 * Ids for a name used in bundles and related.json. «Mathematics» is both a skill and a knowledge area;
 * `prefer` picks between them (related jobs list each name once, so both are returned by default).
 */
export function onetIdsByName(name: string): string[] {
  const n = name.trim().toLowerCase();
  return ONET_ELEMENTS.filter((e) => e.name.toLowerCase() === n).map((e) => e.id);
}

/** Elements left out of gaps: everyone who writes a resume in English shows them. */
export const NEVER_A_GAP: ReadonlySet<string> = new Set(['2.C.7.a', '2.A.1.a']);
