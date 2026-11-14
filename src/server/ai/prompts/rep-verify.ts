import { z } from 'zod';

/**
 * rep.verify: an independent check of a generated rep before anyone sees it. A senior practitioner
 * reads the material with the declared mistakes (Spot the slip) or traps (Delegate) and says, for each,
 * whether it is real and unambiguous, then lists every other error or inconsistency in the material,
 * recomputing every number. Code rejects the rep when a declared item fails or an undeclared error is
 * found whose quote is really in the material.
 */

export const repVerifySchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      real: z.boolean(),
      unambiguous: z.boolean(),
      reason: z.string(),
    }),
  ),
  otherErrors: z.array(z.object({ quote: z.string(), problem: z.string() })),
});
export type RepVerifyOutput = z.infer<typeof repVerifySchema>;

const RULES = [
  'Be a strict, fair reviewer:',
  '- Recompute every number yourself: sums, totals, differences, rates, percentages, quantities, unit conversions, limits, dates and day counts. Show nothing, but base your verdicts on the arithmetic.',
  '- A declared item is real only if it is wrong (or, for a trap, a contradiction) exactly as described. It is unambiguous only if any licensed specialist in this occupation in the US would agree without needing a local policy, a judgment call or information that is not there.',
  '- otherErrors: everything else in the material that a specialist would call a mistake or an inconsistency: wrong arithmetic, contradictions between two places, a wrong rule, form, code or regulator, an impossible value. Quote the exact words (3–20) from the material. Do not list style, wording preferences, missing nice-to-have details, or the declared items themselves. An empty list is the expected answer for good material.',
  '- Write reasons in English, one sentence each.',
];

export const repVerifySlipPrompt = {
  system: () =>
    [
      'You are a senior practitioner checking a training document before it is published. The document is meant to contain exactly the declared mistakes and nothing else wrong.',
      '',
      ...RULES,
    ].join('\n'),
  user: (input: { occupation: string; document: string; errors: { quote: string; type: string; explanation: string; fix: string }[] }) =>
    [
      `Occupation: ${input.occupation}`,
      '',
      'Document:',
      '"""',
      input.document,
      '"""',
      '',
      'Declared mistakes (index | quote | type | why it is wrong | correct version):',
      ...input.errors.map((e, i) => `${i} | ${e.quote} | ${e.type} | ${e.explanation} | ${e.fix}`),
    ].join('\n'),
};

export const repVerifyDelegatePrompt = {
  system: () =>
    [
      'You are a senior practitioner checking the raw material of a training exercise before it is published. The material is meant to contain exactly the declared traps (each a contradiction between two quoted places) and nothing else inconsistent.',
      '',
      ...RULES,
      '- For a trap, real = the two evidence quotes really contradict each other (for numbers: recompute; a total that matches its parts is not a contradiction).',
    ].join('\n'),
  user: (input: { occupation: string; inputs: string; traps: { description: string; evidence: string[] }[] }) =>
    [
      `Occupation: ${input.occupation}`,
      '',
      'Material:',
      '"""',
      input.inputs,
      '"""',
      '',
      'Declared traps (index | description | evidence quotes):',
      ...input.traps.map((t, i) => `${i} | ${t.description} | ${t.evidence.map((q) => `"${q}"`).join(' vs ')}`),
    ].join('\n'),
};
