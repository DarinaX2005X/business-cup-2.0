import { z } from 'zod';
import type { Category, Locale } from '@/domain/types';

/**
 * xray.tips: one call per occupation and language. For every task: a short label a worker would say,
 * one tip chosen by the task's category (computed from data, not by the model), and for ru/kk a faithful
 * translation of the task text. The category and evidence are given; the model must not contradict them.
 */

export const xrayTipsSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      short: z.string(),
      tipHand: z.string().nullable(),
      tipEdge: z.string().nullable(),
      text: z.string().nullable(),
    }),
  ),
});
export type XrayTips = z.infer<typeof xrayTipsSchema>;

export interface TipTaskInput {
  id: string;
  text: string;
  category: Category;
  observed: boolean;
  automation: number | null;
  physical: boolean | null;
}

const LANGUAGE: Record<Locale, string> = { en: 'English', ru: 'Russian', kk: 'Kazakh' };
const NEED: Record<Category, string> = { ai_does: 'HAND', ai_speeds: 'HAND', human_edge: 'EDGE', no_data: 'BOTH' };

export const xrayTipsPrompt = {
  system: (locale: Locale) => {
    const lang = LANGUAGE[locale];
    return [
      'You write short, practical notes for a person who works in the given occupation, task by task. They see these next to data on how much AI is used for each task.',
      '',
      `For every task in the list return one item with the same taskId. Write everything in ${lang}.`,
      `- short: a 2–5 word label a worker in this job would use for the task (for a nurse: "Patient assessment", "Charting", "Medication rounds"). Labels must differ from each other. No trailing period.`,
      '- tipHand (when the task is marked HAND or BOTH, otherwise null): one concrete way to hand this task, or a part of it, to an AI assistant, and what the person must check in the result. Name the real input or document of this job. At most 160 characters. Example for a bookkeeper: "Paste the month\'s bank lines and ask for a draft reconciliation; check every unmatched item against the statement yourself."',
      '- tipEdge (when the task is marked EDGE or BOTH, otherwise null): why this task stays a human strength in this job: physical presence, judgment with incomplete information, trust, responsibility or a relationship. Be specific to the task. At most 160 characters.',
      locale === 'en'
        ? '- text: null.'
        : `- text: a faithful ${lang} translation of the task text, complete, in plain professional language.`,
      '',
      'Rules: the marks come from usage data and research, so do not argue with them. No hype, no predictions about jobs disappearing, no product names, no exclamation marks. Plain sentences.',
    ].join('\n');
  },
  user: (input: { occupation: string; tasks: TipTaskInput[] }) =>
    [
      `Occupation: ${input.occupation}`,
      '',
      'Tasks (id | mark | evidence | text):',
      ...input.tasks.map((t) => {
        const ev = [
          t.observed ? `seen in real AI use${t.automation !== null ? `, ${Math.round(t.automation * 100)}% of it AI doing the task itself` : ''}` : 'research estimate only',
          t.physical ? 'physical task' : null,
        ]
          .filter(Boolean)
          .join('; ');
        return `${t.id} | ${NEED[t.category]} | ${ev} | ${t.text}`;
      }),
    ].join('\n'),
};
