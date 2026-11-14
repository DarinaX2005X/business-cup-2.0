import { z } from 'zod';
import type { Category, Locale } from '@/domain/types';

/**
 * playbook.starter: one generation per occupation and language (run as parallel chunks of tasks).
 * For every task AI already does or speeds up: an instruction the person can paste into ChatGPT,
 * Claude or Copilot today, and the 3–5 checks a professional in this job runs on the result.
 * The code keeps known task ids, trims the checks to five and drops anything too short or too long.
 */

export const playbookStarterSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      instruction: z.string(),
      checks: z.array(z.string()),
    }),
  ),
});
export type PlaybookStarterAnswer = z.infer<typeof playbookStarterSchema>;

export interface StarterTaskInput {
  id: string;
  text: string;
  category: Category;
}

const LANGUAGE: Record<Locale, string> = { en: 'English', ru: 'Russian', kk: 'Kazakh' };

const PART: Partial<Record<Category, string>> = {
  ai_does: 'AI DRAFTS IT: an AI assistant can produce the whole first version; the person reviews it',
  ai_speeds: 'AI HELPS: an AI assistant does one part (drafting, summarising, sorting, checking); the person does the rest',
};

export const playbookStarterPrompt = {
  system: (locale: Locale) => {
    const lang = LANGUAGE[locale];
    return [
      'You write a working playbook for a person in the given occupation. For each of their tasks: one instruction they can paste into ChatGPT, Claude or Copilot today, and the checks a careful professional in this job makes before using what comes back.',
      '',
      `For every task in the list return one item with the same taskId. Write everything in ${lang}.`,
      '',
      'instruction (70 to 150 words, addressed to the AI as "you"):',
      '- Say who the result is for, what to produce and in what format, in the words this profession uses.',
      '- Tell the AI to use only facts from the material the person pastes, and to list anything missing, unclear or contradictory at the end instead of guessing.',
      '- Put what the person pastes or fills in inside square brackets, for example [paste the medication list] or [the client\'s question]. Two to four brackets.',
      '- Scope it to the part AI can do for this task (the mark tells you). The person keeps the judgment and the final decision.',
      '- No real names, no patient or client details, no greeting, no markdown headings, no bullet lists longer than five lines.',
      '',
      'checks (3 to 5 items, each one sentence under 110 characters):',
      '- What a professional in this occupation verifies in the AI result for this task before using it.',
      '- Name the concrete thing to compare: a dose against the order, a total against the source lines, a deadline against the contract, a requirement against the code.',
      '- No generic advice such as "check for accuracy", "proofread" or "review carefully".',
      '',
      'Plain words a colleague would use. No hype, no exclamation marks, nothing about jobs disappearing.',
    ].join('\n');
  },
  user: (input: { occupation: string; tasks: StarterTaskInput[] }) =>
    [`Occupation: ${input.occupation}`, '', 'Tasks (id | mark | text):', ...input.tasks.map((t) => `${t.id} | ${PART[t.category] ?? PART.ai_speeds} | ${t.text}`)].join('\n'),
};
