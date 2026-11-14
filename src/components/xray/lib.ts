import { intlLocale, type Locale } from '@/i18n/config';
import type { Category } from '@/domain/types';

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

/** Below this share the human edge is too small to carry the conclusion on its own. */
export const SMALL_EDGE = 15;

/* ---------- task labels: one source for step 3 of /start and the week map ---------- */

const DANGLING = new Set(['and', 'or', 'to', 'for', 'with', 'as', 'of', 'the', 'a', 'an', 'in', 'on', 'by', 'from', 'such', 'including', 'using', 'и', 'в', 'на', 'для', 'с', 'по', 'мен', 'және']);

/** Drops a trailing comma or function word, which heuristic labels can end on. */
export function tidyLabel(label: string) {
  const words = label.replace(/[,;:]+$/, '').split(/\s+/);
  while (words.length > 2 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[,;:]$/, ''))) words.pop();
  return words.join(' ').replace(/[,;:]+$/, '');
}

/** Short label without the model: the task up to its first clause, never ending on «and». */
export function quickLabel(text: string) {
  const words = text.replace(/[.;:]+\s*$/, '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    if (out.length >= 5 || (/[,;:]$/.test(w) && out.length >= 3)) break;
  }
  return tidyLabel(out.join(' '));
}

/**
 * The label of a task, the same everywhere: the generated label in the person's language when it exists,
 * else the label the data build wrote (English), else the first clause of the task.
 */
export function taskLabel(generated: string | null | undefined, task: { short?: string; text: string } | undefined): string {
  const short = generated ?? task?.short;
  return short ? tidyLabel(short) : quickLabel(task?.text ?? '');
}

/**
 * Two tasks of one week must never share a label: the later ones fall back to their full task text
 * (in the same language), which is always distinct.
 */
export function distinctLabels(ids: string[], labelOf: (id: string) => string, textOf: (id: string) => string): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const id of ids) {
    const l = labelOf(id);
    const k = l.trim().toLocaleLowerCase();
    if (seen.has(k)) {
      const first = seen.get(k)!;
      out.set(first, textOf(first) || l);
      out.set(id, textOf(id) || l);
    } else {
      seen.set(k, id);
      out.set(id, l);
    }
  }
  return out;
}
