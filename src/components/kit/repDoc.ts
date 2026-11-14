/*
 * Light document markup for Rep cards: `# ` and `## ` headings, `- ` list items, `|` tables,
 * a short line right under the title becomes its subtitle. Every visible text keeps the
 * offset of its first character in the source, so highlights map back to source ranges.
 */

import type { CharRange } from './types';

export interface TextPart {
  start: number;
  text: string;
}

export type DocBlock =
  | { kind: 'h1' | 'h2' | 'sub' | 'p' | 'li'; part: TextPart }
  | { kind: 'table'; head: TextPart[]; rows: TextPart[][] };

export function parseDoc(src: string): DocBlock[] {
  const lines: { text: string; start: number }[] = [];
  let pos = 0;
  for (const text of src.split('\n')) {
    lines.push({ text, start: pos });
    pos += text.length + 1;
  }
  const blocks: DocBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const { text, start } = lines[i];
    const trimmed = text.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const lead = text.length - text.trimStart().length;
    if (trimmed.startsWith('|')) {
      const rows: TextPart[][] = [];
      while (i < lines.length && lines[i].text.trim().startsWith('|')) {
        const line = lines[i];
        if (!/^\s*\|?\s*:?-{2,}/.test(line.text)) rows.push(cells(line.text, line.start));
        i++;
      }
      blocks.push({ kind: 'table', head: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (trimmed.startsWith('## ')) blocks.push({ kind: 'h2', part: { start: start + lead + 3, text: trimmed.slice(3) } });
    else if (trimmed.startsWith('# ')) {
      blocks.push({ kind: 'h1', part: { start: start + lead + 2, text: trimmed.slice(2) } });
      const next = lines[i + 1];
      if (next && next.text.trim() && !/^(#|-|\|)/.test(next.text.trim()) && next.text.length < 90) {
        blocks.push({ kind: 'sub', part: { start: next.start, text: next.text } });
        i++;
      }
    } else if (/^[-*] /.test(trimmed)) blocks.push({ kind: 'li', part: { start: start + lead + 2, text: trimmed.slice(2) } });
    else blocks.push({ kind: 'p', part: { start: start + lead, text: trimmed } });
    i++;
  }
  return blocks;
}

function cells(line: string, lineStart: number): TextPart[] {
  const out: TextPart[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (line[i] === '|') {
      i++;
      continue;
    }
    const j = line.indexOf('|', i);
    const end = j < 0 ? n : j;
    const raw = line.slice(i, end);
    const l = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ start: lineStart + i + l, text: t });
    i = end;
  }
  return out;
}

/** All text parts in reading order. */
export function partsOf(blocks: DocBlock[]): TextPart[] {
  return blocks.flatMap((b) => (b.kind === 'table' ? [...b.head, ...b.rows.flat()] : [b.part]));
}

const WORD = /[\p{L}\p{N}]/u;
const JOIN = /['’.,:/%\-]/u;

const isWord = (src: string, i: number) => {
  const c = src[i];
  if (!c) return false;
  if (WORD.test(c)) return true;
  // 8.4, 1:2, don't, community-acquired and 88% stay inside one word
  const prev = WORD.test(src[i - 1] ?? '');
  const next = WORD.test(src[i + 1] ?? '');
  if (c === '%' && prev) return true;
  return JOIN.test(c) && prev && next;
};

/** The word around position `p`, or the nearest word to its left. */
export function wordAt(src: string, p: number): CharRange | null {
  let i = Math.min(Math.max(0, p), src.length - 1);
  if (!isWord(src, i)) {
    if (isWord(src, i - 1)) i = i - 1;
    else return null;
  }
  let s = i;
  let e = i + 1;
  while (s > 0 && isWord(src, s - 1)) s--;
  while (e < src.length && isWord(src, e)) e++;
  return [s, e];
}

/** Expands a raw range to whole words at both ends. */
export function toWords(src: string, a: number, b: number): CharRange | null {
  let s = Math.min(a, b);
  let e = Math.max(a, b);
  while (s < e && !isWord(src, s)) s++;
  while (e > s && !isWord(src, e - 1)) e--;
  if (s >= e) return wordAt(src, s);
  const ws = wordAt(src, s);
  const we = wordAt(src, e - 1);
  return [ws ? ws[0] : s, we ? we[1] : e];
}

/** Sorted, merged ranges (overlapping or touching ranges join). */
export function mergeRanges(ranges: CharRange[]): CharRange[] {
  const sorted = [...ranges].filter((r) => r[1] > r[0]).sort((x, y) => x[0] - y[0]);
  const out: CharRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Word ranges of all visible text, for keyboard movement. */
export function wordsOf(parts: TextPart[]): CharRange[] {
  const out: CharRange[] = [];
  for (const p of parts) {
    const re = /[\p{L}\p{N}]+(?:['’.,:/%\-][\p{L}\p{N}]+)*%?/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.text))) out.push([p.start + m.index, p.start + m.index + m[0].length]);
  }
  return out;
}
