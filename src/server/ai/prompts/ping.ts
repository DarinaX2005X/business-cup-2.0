import { z } from 'zod';

/** Smallest real call: checks the key, the model, strict JSON schema (incl. a nullable field) and reasoning cost. */
export const pingSchema = z.object({
  word: z.string(),
  language: z.enum(['en', 'ru', 'kk']),
  letters: z.number().int().nullable(),
});

export const pingPrompt = {
  system: 'You answer with a single JSON object that matches the schema. No commentary.',
  user: 'Give the Russian word for "work", its language code, and the number of letters in it. If you are unsure of the count, use null.',
};
