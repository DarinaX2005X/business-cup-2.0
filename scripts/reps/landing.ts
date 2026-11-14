import { validateSlip, type SlipErrorType } from '@/domain/reps';
import { AiError, callModel } from '@/server/ai/client';
import { repSlipPrompt, repSlipSchema, type RepSlipOutput } from '@/server/ai/prompts/rep-slip';
import type { BankSlip } from '@/server/reps';

/**
 * Landing minis (03.3): a 3-4 sentence document with exactly one mistake, made with the same slip
 * prompt (n = 1) and the same quote check as every other slip. Only the length rules differ, so the
 * two length lines of the slip prompt are replaced; everything else stays.
 */

export const LANDING_WORDS = { min: 28, max: 95 } as const;

const LENGTH_RULE = `- A mini document of 3 or 4 sentences, ${LANDING_WORDS.min + 7} to 80 words in all, one short paragraph with no headings, lists or tables. Every sentence carries concrete details (names, numbers, times, doses, amounts). It is shown on a landing page, so it must be readable in ten seconds.`;
const FORMAT_RULE = '- Plain text only. The first line is "# " plus the document title, then a blank line, then the paragraph. No bold, italics, links or HTML.';

export async function generateLanding(input: {
  occupationCode: string;
  occupation: string;
  taskId: string;
  task: string;
  taskShort: string;
  types: SlipErrorType[];
  seed: string;
}): Promise<{ entry: BankSlip; attempts: number; costUsd: number; rejected: string[][] }> {
  const lines = repSlipPrompt.system('en').split('\n');
  const replaced = { length: false, format: false };
  const system = lines
    .map((l) => {
      if (l.startsWith('- 180 to 350 words')) return (replaced.length = true), LENGTH_RULE;
      if (l.startsWith('- Formatting is plain text')) return (replaced.format = true), FORMAT_RULE;
      return l;
    })
    .join('\n');
  if (!replaced.length || !replaced.format) throw new Error('the slip prompt changed: update the two length lines replaced in scripts/reps/landing.ts');

  let retry: { previous: RepSlipOutput; problems: string[] } | null = null;
  let cost = 0;
  const rejected: string[][] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, usage }: { data: RepSlipOutput; usage: { costUsd: number } } = await callModel({
      op: 'rep.slip',
      schema: repSlipSchema,
      system,
      user: repSlipPrompt.user({ occupation: input.occupation, task: input.task, taskShort: input.taskShort, locale: 'en', difficulty: 1, types: input.types, seed: input.seed, retry }),
      locale: 'en',
      maxTokens: 2000,
      temperature: 0.9,
      reasoning: 'minimal',
    });
    cost += usage.costUsd;
    const checked = validateSlip(data, { n: 1, types: [...new Set(input.types)], minWords: LANDING_WORDS.min, maxWords: LANDING_WORDS.max });
    // the shared check words its length message for full documents; this one is for minis
    const problems = checked.ok ? [] : checked.problems.map((p) => (/must have 180–350/.test(p) ? `The document has the wrong length; it must be ${LANDING_WORDS.min + 7}-80 words, 3 or 4 sentences.` : p));
    const sentences = checked.ok ? checked.content.slip.document.split('\n').slice(1).join(' ').split(/(?<=[.!?])\s+/).filter(Boolean).length : 0;
    if (checked.ok && (sentences < 3 || sentences > 4)) problems.push(`The document has ${sentences} sentences; it must have 3 or 4.`);
    if (checked.ok && !problems.length) {
      const c = checked.content;
      return {
        entry: { type: 'slip', occupationCode: input.occupationCode, taskId: input.taskId, locale: 'en', difficulty: 1, title: c.title, brief: c.brief, docType: c.docType, slip: c.slip },
        attempts: attempt,
        costUsd: cost,
        rejected,
      };
    }
    rejected.push(problems);
    retry = { previous: data, problems };
  }
  throw new AiError('invalid_output', 'landing mini failed validation 3 times', { op: 'rep.slip' });
}
