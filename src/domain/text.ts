/**
 * Task-text normalisation for joins across datasets. Same rules as research/probe/common.py norm_text:
 * lower-case, straighten quotes and dashes, collapse whitespace, strip surrounding quotes and the final period.
 */
export function normTaskText(text: string): string {
  let t = String(text).trim().toLowerCase();
  t = t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/[–—]/g, '-');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^[ "]+|[ "]+$/g, '');
  t = t.replace(/\.+$/, '').trim();
  return t;
}

const SENIORITY = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'i', 'ii', 'iii', 'iv', 'entry', 'level', 'trainee', 'intern']);

/**
 * Title normalisation for search: lower-case, no diacritics, & → and, parenthetical notes split off.
 * Kazakh and Russian letters survive (only combining marks are removed after NFD, then recomposed).
 */
export function normTitle(title: string): { main: string; paren: string } {
  const parens: string[] = [];
  const withoutParens = String(title).replace(/\(([^)]*)\)/g, (_, inner: string) => {
    parens.push(inner);
    return ' ';
  });
  return { main: cleanTitle(withoutParens), paren: cleanTitle(parens.join(' ')) };
}

function cleanTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Query normalisation: like titles, plus seniority words removed (unless nothing else is left). */
export function normQuery(query: string): string {
  const { main, paren } = normTitle(query);
  const words = `${main} ${paren}`.trim().split(' ').filter(Boolean);
  const kept = words.filter((w) => !SENIORITY.has(w));
  return (kept.length ? kept : words).join(' ');
}

export function hasCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}

/** URL slug from an O*NET title: ascii, lower-case, hyphens. */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
