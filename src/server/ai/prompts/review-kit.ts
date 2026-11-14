import { z } from 'zod';
import type { Category, Locale } from '@/domain/types';

/**
 * review.kit: the three written sections of a one-page brief for a talk with one's manager (05.1.3).
 * The model only words facts it is given: the person's week map, the reps they completed and what they
 * caught, how often they used a task at work, and the nearest neighbouring job. Headings, order and the
 * Evidence list are code. The server drops every item whose numbers are not in the facts, and every item
 * that names a task outside the facts.
 */

export const reviewKitSchema = z.object({
  changed: z.array(z.object({ taskId: z.string(), text: z.string() })),
  judgment: z.array(z.object({ taskId: z.string(), text: z.string() })),
  next: z.array(z.object({ text: z.string() })),
});
export type ReviewKitDraft = z.infer<typeof reviewKitSchema>;

export interface ReviewTask {
  id: string;
  label: string;
  text: string;
  category: Category;
  hours: number;
}

export interface ReviewRep {
  day: string;
  type: 'slip' | 'delegate' | 'edge';
  taskId: string;
  score: number;
  what: string;
  caught: string[];
}

export interface ReviewFacts {
  occupation: string;
  tasks: ReviewTask[];
  reps: ReviewRep[];
  work: { taskId: string; times: number; minutes: number }[];
  neighbour: { title: string; skills: string[] } | null;
}

const LANGUAGE: Record<Locale, string> = { en: 'English', ru: 'Russian', kk: 'Kazakh' };
const KIND: Record<Category, string> = {
  ai_does: 'AI already does it',
  ai_speeds: 'AI speeds it up',
  human_edge: 'my human edge',
  no_data: 'no AI data yet',
};
const TYPE: Record<ReviewRep['type'], string> = {
  slip: 'Spot the slip (found mistakes an AI planted in a work document)',
  delegate: 'Delegate (wrote instructions for AI, then checked its result)',
  edge: 'Human edge (handled a hard conversation that needs a person)',
};

export const reviewKitPrompt = {
  system: (locale: Locale) => {
    const lang = LANGUAGE[locale];
    return [
      'You help a working professional prepare for a conversation with their manager about their role and a raise.',
      'You write three short sections of a one-page brief, in the first person ("I"), from the facts below and nothing else.',
      '',
      `Write every text in ${lang}. Plain, calm sentences a person would say out loud. No headings, no lists inside a text, no exclamation marks, no hype words.`,
      '',
      'Sections:',
      '- changed: up to 3 items. Each names one task from the facts that I now do with AI help (prefer tasks marked "AI already does it" or "AI speeds it up" that I practised), how I hand it to AI and what I check. Mention the hours a week from the facts when it helps.',
      '- judgment: up to 3 items. Each names one task where my judgment matters, with a concrete example from the reps: what I caught or handled (for a nurse: "caught a dosage inconsistency in an AI-drafted handoff"). Use the "caught" notes when there are any.',
      '- next: up to 3 items. What I can take on next: human-edge tasks I have not practised yet, and skills of the nearby job when given.',
      '',
      'Each item: taskId is the id from the facts (use the task the text is about), text is one or two sentences, at most 220 characters.',
      '',
      'Hard rules:',
      '- Use only the facts given. Do not invent anything about the employer, the team, patients, clients, results, money saved, promotions or dates.',
      '- Every number you write must appear in the facts exactly (hours, scores, counts). Do not compute new numbers, do not write dates or percentages that are not in the facts.',
      '- Do not mention points, streaks, this app, scores out of 100 or the word "rep". Say "a practice exercise" or describe what happened instead.',
      '- If the facts do not support an item, return fewer items. Empty lists are allowed.',
    ].join('\n');
  },
  user: (f: ReviewFacts) => {
    const lines = [
      `Occupation: ${f.occupation}`,
      '',
      'My week (task id | kind | hours a week | short name | task):',
      ...f.tasks.map((t) => `${t.id} | ${KIND[t.category]} | ${t.hours} | ${t.label} | ${t.text}`),
      '',
      'Practice exercises I completed (task id | exercise | score out of 100 | what happened | what I caught):',
      ...f.reps.map((r) => `${r.taskId} | ${TYPE[r.type]} | ${r.score} | ${r.what} | ${r.caught.length ? r.caught.join('; ') : 'none listed'}`),
    ];
    if (f.work.length) {
      lines.push('', 'Times I used this at work (task id | times | minutes in total):', ...f.work.map((w) => `${w.taskId} | ${w.times} | ${w.minutes}`));
    }
    if (f.neighbour) {
      lines.push('', `Nearby job: ${f.neighbour.title}. Skills it asks for that I could build: ${f.neighbour.skills.join(', ') || 'none listed'}.`);
    }
    return lines.join('\n');
  },
};
