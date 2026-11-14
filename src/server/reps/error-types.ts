import type { SlipErrorType } from '@/domain/reps';

/**
 * Mistake types planted in Spot the slip, by SOC major group (first digits of the O*NET-SOC code).
 * More specific prefixes come first (43-3 finance clerks, 43-4 customer-facing clerks).
 */
const TABLE: { prefixes: string[]; types: SlipErrorType[] }[] = [
  { prefixes: ['43-3'], types: ['calculation', 'compliance', 'logic'] },
  { prefixes: ['43-4'], types: ['tone', 'omission', 'fact'] },
  { prefixes: ['29'], types: ['fact', 'omission', 'compliance'] },
  { prefixes: ['13'], types: ['calculation', 'compliance', 'logic'] },
  { prefixes: ['41', '27'], types: ['tone', 'omission', 'fact'] },
  { prefixes: ['47', '49'], types: ['calculation', 'compliance', 'fact'] },
  { prefixes: ['25'], types: ['fact', 'logic', 'omission'] },
  { prefixes: ['23'], types: ['compliance', 'fact', 'logic'] },
];

const DEFAULT_TYPES: SlipErrorType[] = ['fact', 'logic', 'omission'];

export function errorTypesFor(code: string): SlipErrorType[] {
  for (const row of TABLE) if (row.prefixes.some((p) => code.startsWith(p))) return row.types;
  return DEFAULT_TYPES;
}

/**
 * The type of each of the `n` mistakes: the group's types in turn, starting at a seed-dependent offset,
 * so two mistakes are always of different types and four repeat one.
 */
export function plannedTypes(code: string, n: number, offset: number): SlipErrorType[] {
  const types = errorTypesFor(code);
  return Array.from({ length: n }, (_, i) => types[(i + offset) % types.length]);
}

/** What each type means, as told to the model (and usable as a tooltip). */
export const TYPE_GUIDE: Record<SlipErrorType, string> = {
  fact: 'a wrong value, name, date, unit or statement that contradicts data elsewhere in the document or basic knowledge every practitioner has',
  calculation: 'arithmetic that does not hold (a total, rate, dose, load, percentage or conversion); every number needed to check it is in the document',
  compliance: 'breaks a rule every licensed practitioner knows (a law, code, standard, required procedure or safety rule), not a local policy',
  omission: 'something this document must contain is missing; the quote is the line where it belongs and the explanation names what is missing',
  logic: 'a conclusion or instruction that does not follow from the document\'s own data, or contradicts another part of it',
  tone: 'wording wrong for the reader: blaming, dismissive, jargon to a lay reader, or a promise the writer cannot keep',
};
