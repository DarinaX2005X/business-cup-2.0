import { intlLocale, type Locale } from '@/i18n/config';
import type { Category } from '@/domain/types';

/** 10-point bucket of the machine part of the week, for the conclusion sentence keys (0, 10 … 90). */
export function machineBucket(percentMachine: number): number {
  return Math.min(90, Math.max(0, Math.floor(percentMachine / 10) * 10));
}

/** Lower-cases the first letter of a label used mid-sentence, unless it starts an acronym («AI», «ICU»). */
export function midSentence(label: string): string {
  if (label.length < 2) return label;
  const [a, b] = [label[0], label[1]];
  if (b !== b.toLowerCase()) return label;
  return a.toLowerCase() + label.slice(1);
}

/** «A, b and c» in the interface language. */
export function joinLabels(labels: string[], locale: Locale): string[] {
  if (labels.length === 0) return [];
  const items = labels.map((l, i) => (i === 0 ? l : midSentence(l)));
  try {
    const parts = new Intl.ListFormat(intlLocale[locale], { style: 'long', type: 'conjunction' }).formatToParts(items);
    return parts.map((p) => p.value);
  } catch {
    return items.flatMap((l, i) => (i === 0 ? [l] : [', ', l]));
  }
}

export const MACHINE: Category[] = ['ai_does', 'ai_speeds'];

/** Hours a hand-to-AI task frees: all of it when AI already does it, half when AI speeds it up. */
export const freedFactor = (c: Category) => (c === 'ai_does' ? 1 : c === 'ai_speeds' ? 0.5 : 0);

export const round1 = (x: number) => Math.round(x * 10) / 10;

/** A week keeps at least this many tasks while editing (the /start flow proposes 4..14). */
export const MIN_TASKS = 4;

/** A label that would put English words inside a Russian or Kazakh sentence (not translated yet). */
export function isForeignLabel(label: string, locale: Locale): boolean {
  return locale !== 'en' && !/[\u0400-\u04FF]/.test(label);
}

/** «an AP clerk», «a nurse»: the indefinite article for an English job title, by its first sound. */
export function withArticle(title: string): string {
  const t = title.trim();
  const acronym = /^[A-Z]{2}/.test(t);
  const first = t[0]?.toUpperCase() ?? '';
  const vowelSound = acronym ? 'AEFHILMNORSX'.includes(first) : /^[aeiou]/i.test(t) && !/^(uni|use|usu|eu|one)/i.test(t);
  return `${vowelSound || /^hour|^honest|^heir/i.test(t) ? 'an' : 'a'} ${t}`;
}

/** The job as it goes into «Your week as …»: with the English article, in quotes elsewhere (no declension). */
export function roleOf(jobTitle: string, locale: Locale): string {
  // «a registered nurse», «an AP clerk»: a title typed in title case reads as a name mid-sentence.
  return locale === 'en' ? withArticle(midSentence(jobTitle.trim())) : jobTitle;
}

/** Below this share the human edge is too small to carry the conclusion on its own. */
export const SMALL_EDGE = 15;
