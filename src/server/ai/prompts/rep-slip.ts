import { z } from 'zod';
import { hash32, LANGUAGE_NAME, type SlipErrorType } from '@/domain/reps';
import type { Locale } from '@/domain/types';
import { TYPE_GUIDE } from '@/server/reps/error-types';

/**
 * rep.slip: a realistic work document an AI assistant drafted for one task of the person's job, with
 * exactly n planted mistakes. The system part is English; the document is in the user's language.
 * Quotes are verified by code (validateSlip); a failed check comes back here as `problems`.
 */

export const repSlipSchema = z.object({
  title: z.string(),
  docType: z.string(),
  brief: z.string(),
  document: z.string(),
  errors: z.array(
    z.object({
      quote: z.string(),
      type: z.enum(['fact', 'logic', 'compliance', 'omission', 'tone', 'calculation']),
      explanation: z.string(),
      fix: z.string(),
    }),
  ),
});
export type RepSlipOutput = z.infer<typeof repSlipSchema>;

export interface RepSlipInput {
  occupation: string;
  task: string;
  taskShort: string;
  locale: Locale;
  difficulty: 1 | 2 | 3;
  types: SlipErrorType[];
  seed: string;
  /** Problems found by the validator in the previous attempt, with that attempt. */
  retry?: { previous: RepSlipOutput; problems: string[] } | null;
}

const DIFFICULTY: Record<1 | 2 | 3, string> = {
  1: 'Level 1: each mistake is clear once you read the line carefully, like a dose that contradicts the allergy list or a total that is off by a round amount.',
  2: 'Level 2: mistakes need attention: a value slightly outside the safe range, a step out of order, a missing requirement a practitioner expects.',
  3: 'Level 3: mistakes need expertise and cross-checking two places in the document, but each is still plainly wrong to a specialist once noticed.',
};

/**
 * Invented names the generator is told to use, picked from the seed so that two documents rarely share
 * a person or a company. The bank rewrite (scripts/reps/names.ts) draws from the same pool.
 */
export const FIRST_NAMES = ['Daniel', 'Priya', 'Lucas', 'Maria', 'Tyrone', 'Hannah', 'Omar', 'Grace', 'Ethan', 'Linh', 'Rosa', 'Caleb', 'Nadia', 'Frank', 'Julia', 'Andre', 'Wendy', 'Samuel', 'Keiko', 'Walter', 'Teresa', 'Dmitri', 'Alicia', 'Victor', 'Megan', 'Raymond', 'Isabel', 'Curtis', 'Fatima', 'Gordon', 'Naomi', 'Paul', 'Leah', 'Hector', 'Colleen', 'Jamal', 'Irene', 'Brandon', 'Sunita', 'Neil'];
export const LAST_NAMES = ['Okafor', 'Brennan', 'Castillo', 'Lindqvist', 'Mahoney', 'Tran', 'Whitfield', 'Duarte', 'Kowalczyk', 'Banerjee', 'Hollis', 'Moreau', 'Abbott', 'Nguyen', 'Sandoval', 'Pruitt', 'Haddad', 'Ellison', 'Fitzgerald', 'Ramos', 'Coleman', 'Yamamoto', 'Delgado', 'Thornton', 'Petrov', 'Gallagher', 'Osei', 'Larkin', 'Bishop', 'Navarro', 'Hendricks', 'Sato', 'Maddox', 'Ferreira', 'Quinn', 'Weaver', 'Ibrahim', 'Rowland', 'Santoro', 'Kim'];
export const COMPANY_STEMS = ['Cedar Ridge', 'Harbor Point', 'Northfield', 'Bluestone', 'Maple Grove', 'Redwood', 'Lakeside', 'Ironwood', 'Summit View', 'Pinecrest', 'Westbrook', 'Silverline', 'Oak Hollow', 'Brightwater', 'Stonebridge', 'Foxglove', 'Riverbend', 'Clearwater', 'Eastgate', 'Granite Peak', 'Meadowlark', 'Copperfield', 'Willow Creek', 'Highland', 'Juniper', 'Tidewater', 'Sunnyside', 'Crossroads', 'Birchwood', 'Fairview'];
/** Names that earlier drafts overused; the prompt forbids them and the bank rewrite replaces them. */
export const OVERUSED_NAMES = ['Marcus Vance', 'Elena Rostova', 'Sarah Jenkins', 'Eleanor Vance', 'Arthur Pendelton', 'Apex'];

export function nameSuggestions(seed: string): { people: string[]; company: string } {
  const h = hash32(seed);
  const people = [0, 1, 2].map((i) => `${FIRST_NAMES[(h + i * 13) % FIRST_NAMES.length]} ${LAST_NAMES[(Math.floor(h / 7) + i * 17) % LAST_NAMES.length]}`);
  return { people, company: COMPANY_STEMS[Math.floor(h / 11) % COMPANY_STEMS.length] };
}

export const repSlipPrompt = {
  system: (locale: Locale) => {
    const lang = LANGUAGE_NAME[locale];
    return [
      'You write training material for working professionals. The exercise is called "Spot the slip": a professional reviews a work document that an AI assistant drafted for one of their real tasks, and finds the mistakes the AI made. Your document must feel like the real thing a person in this job reads at work, so that finding the mistakes is real practice.',
      '',
      'THE DOCUMENT',
      `- Write it in ${lang}. It is a real document type of this occupation for the given task (for a registered nurse: discharge instructions, a shift handoff note, a care plan; for an accountant: a bank reconciliation, an accrual memo; for an electrician: a load calculation, an inspection checklist, a service quote).`,
      '- Setting: a workplace in the United States in 2026. Use US conventions: US customary units (lb, °F, ft, in, gal), lab values in US units (mg/dL), USD amounts, dates as MM/DD/YYYY, US regulators, codes and forms and the US terms of the profession (PCP, MAR, Joint Commission, W-2, 1099-NEC, GAAP, IRS, NEC 2023, OSHA).',
      locale === 'en' ? '' : `- Keep the US setting and its units and forms, but write them the way a ${lang}-speaking professional would read them naturally.`,
      '- 180 to 350 words. Concrete, specific, dense with realistic details: names, numbers, times, doses, amounts, item lists. No filler and no lessons.',
      '- Formatting is plain text with this light markup only: the first line is "# " plus the document title; an optional short subtitle line under it; "## " for section headings; "- " for list items; simple tables with "|" between cells (a header row, a separator row like "| --- | --- |", then rows). No bold, italics, links or HTML.',
      '- All people, organisations, addresses and IDs are invented. No real people, real companies, real hospitals, real brands. Generic drug names only.',
      `- People and organisations have ordinary, varied US names that fit the setting (a mix of backgrounds, not one pattern). Never use ${OVERUSED_NAMES.join(', ')} or any company whose name starts with Apex.`,
      '- Do not write placeholders like [Name] or [Date]; invent the values.',
      '- Do not hint at the mistakes: no comments, no "(check this)", no question marks around them.',
      '',
      'THE MISTAKES',
      '- Plant exactly the requested number of mistakes, of the requested types, one per place. Everything else in the document must be correct, consistent and complete: a specialist reading it must find these mistakes and nothing else.',
      '- Each mistake must be unambiguous for a specialist: clearly wrong, not a matter of local policy, style or borderline judgment. The best mistakes contradict information elsewhere in the same document (an allergy in the header, a total that is not the sum of its lines, a breaker size that does not match the wire gauge) or break a rule every licensed practitioner in this job knows.',
      '- Put each mistake in a short, specific phrase of a sentence or a "- " list item, never inside a table: tables hold the correct reference data (allergies, vitals, line items, measurements) that the mistakes elsewhere contradict. Do not put two mistakes in one sentence.',
      '- An omission must be a missing item that matters for safety, money, compliance or the customer outcome: a missing allergy check, a missing dose or route, a missing deadline, a missing required disclosure or inspection step. A missing name, ID, serial or lot number, phone number, code, URL or price does not count; the fix must not be just such a detail. Never a nice-to-have detail.',
      '',
      'FOR EACH MISTAKE RETURN',
      '- quote: the exact words from the document that contain the mistake, copied character for character. 5 to 12 words is ideal, never fewer than 4 or more than 30. It must sit inside one line outside any table, contain no markup characters (| # * _ ` [ ]), not start with "- ", and occur only once in the document. Prefer the shortest phrase that includes the wrong part itself (the wrong number, the wrong drug, the missing time frame).',
      '- type: one of the requested types.',
      `- explanation: one or two sentences in ${lang} saying why it is wrong, pointing to the evidence (the other line of the document, or the rule).`,
      `- fix: the corrected wording of the quoted phrase, in ${lang}.`,
      '',
      'ALSO RETURN',
      `- title: the document title as it appears after "# ", in ${lang}.`,
      `- docType: the kind of document in 1 to 4 lower-case words in ${lang} (for example "discharge instructions", "bank reconciliation").`,
      `- brief: one sentence in ${lang} saying what the AI was asked to draft and from what (for example "Discharge instructions for a 67-year-old patient going home after a knee replacement, drafted from the chart.").`,
    ]
      .filter(Boolean)
      .join('\n');
  },

  user: (input: RepSlipInput) => {
    const names = nameSuggestions(input.seed);
    const lines = [
      `Occupation: ${input.occupation}`,
      `Task: ${input.task}`,
      `Task in short: ${input.taskShort}`,
      `Number of mistakes: ${input.types.length}`,
      ...input.types.map((t, i) => `Mistake ${i + 1} type: ${t} (${TYPE_GUIDE[t]})`),
      DIFFICULTY[input.difficulty],
      `Variation code: ${input.seed} (use it to vary the case: different people, numbers and situation from the most typical example).`,
      `Names to use where the document needs them: people ${names.people.join(', ')}; organisation name based on "${names.company}".`,
    ];
    if (input.retry) {
      lines.push(
        '',
        'Your previous answer is below. It failed these checks:',
        ...input.retry.problems.map((p) => `- ${p}`),
        '',
        'Return the whole corrected answer. Keep what was fine; make every quote an exact, unique copy of a phrase in the document.',
        '',
        'Previous answer:',
        JSON.stringify(input.retry.previous),
      );
    }
    return lines.join('\n');
  },
};
