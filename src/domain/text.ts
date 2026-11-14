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

const LABEL_STOP = new Set([
  'to', 'for', 'of', 'in', 'with', 'by', 'on', 'from', 'such', 'as', 'using', 'that', 'which', 'including', 'according',
  'when', 'during', 'at', 'into', 'through', 'and', 'or', 'about', 'under', 'within', 'per', 'via', 'so', 'if', 'while',
  'before', 'after', 'upon', 'between', 'among', 'regarding', 'concerning', 'toward', 'towards', 'like', 'whether',
]);
const ADJECTIVE = /(al|ic|ive|ous|ary|ful|ent|ant|ed|ing|ical|ory|ate)$/i;
const QUANTITY = new Set(['variety', 'range', 'number', 'types', 'type', 'kinds', 'kind', 'aspects', 'aspect', 'set', 'series', 'array', 'sorts', 'forms', 'parts', 'portion', 'amount', 'amounts', 'level', 'levels']);
const LABEL_SKIP = new Set(['a', 'an', 'the', 'all', 'any', 'various', 'other', 'appropriate', 'necessary', 'specific', 'specified', 'related', 'relevant', 'required', 'existing', 'new', 'each']);

/**
 * Deterministic short label for an O*NET task (fallback when no model-written label exists):
 * the first verb plus the head of its object, at most 4 words, no trailing punctuation.
 * "Record patients' medical information and vital signs." → "Record medical information";
 * "Prepare, examine, or analyze accounting records…" → "Prepare accounting records".
 */
export function shortLabel(text: string): string {
  const tokens = String(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/([,;:.])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return '';
  const verb = tokens[0].replace(/[^\p{L}-]/gu, '');
  let i = 1;
  // Verb lists: "Prepare, examine, or analyze X" / "Direct or coordinate X" → object of the last verb.
  if (tokens[i] === ',' || /^(or|and)$/i.test(tokens[i] ?? '')) {
    let j = i;
    while (j < tokens.length && j < 12 && !/^(or|and)$/i.test(tokens[j])) j++;
    if (j < tokens.length && j < 12) i = j + 2;
  }
  const phrase: string[] = [];
  const clean = (w: string) => w.replace(/['’]s$/i, '').replace(/[^\p{L}\p{N}'’/-]/gu, '');
  for (; i < tokens.length; i++) {
    const w = tokens[i];
    const lower = w.toLowerCase();
    // 'financial or budget activities': a conjunction after an adjective joins modifiers, keep going.
    // 'accurate, detailed reports' works the same way with a comma.
    if (/^(or|and|,)$/.test(lower) && phrase.length && ADJECTIVE.test(phrase[phrase.length - 1]) && !LABEL_STOP.has(tokens[i + 1]?.toLowerCase() ?? '.')) {
      phrase.length = 0;
      continue;
    }
    // 'a variety of tools', 'all aspects of patient care': the quantity word is not the object.
    if (lower === 'of' && phrase.length && QUANTITY.has(phrase[phrase.length - 1].toLowerCase())) {
      phrase.length = 0;
      continue;
    }
    if (/^[,;:.]$/.test(w) || LABEL_STOP.has(lower)) {
      // 'Confer with customers': no direct object, so keep the preposition and its noun.
      if (!phrase.length && LABEL_STOP.has(lower) && !/^(and|or)$/.test(lower)) {
        const tail: string[] = [];
        for (let k = i + 1; k < tokens.length && tail.length < 2; k++) {
          const t = tokens[k].toLowerCase();
          if (/^[,;:.]$/.test(t) || LABEL_STOP.has(t)) break;
          if (!tail.length && LABEL_SKIP.has(t)) continue;
          tail.push(clean(tokens[k]));
        }
        if (tail.length) return [verb, lower, ...tail.slice(-2)].join(' ');
      }
      break;
    }
    if (!phrase.length && LABEL_SKIP.has(lower)) continue;
    phrase.push(clean(w));
  }
  // Possessives ("patients'") and adjectives come first; the head noun is last, so keep the tail.
  const object = phrase.filter((w) => w && !/['’]$/.test(w)).slice(-3);
  return [verb, ...object].join(' ').trim();
}

/** Last words that leave a label hanging ("Perform duties related", "Maintain accurate", "Determine size"). */
const BAD_END = new Set([
  'related', 'accurate', 'detailed', 'necessary', 'appropriate', 'various', 'other', 'such', 'general', 'specific', 'overall',
  'daily', 'new', 'existing', 'proper', 'required', 'relevant', 'current', 'additional', 'special', 'all', 'size', 'duties',
  'functions', 'activities', 'aspects', 'matters', 'things', 'items', 'issues', 'tasks', 'work', 'variety', 'types', 'needs',
  'ensure', 'determine', 'assist', 'help', 'make', 'use', 'perform', 'provide',
]);
const PARTICIPLE_ING = new Set(['detailing', 'including', 'involving', 'concerning', 'regarding', 'using', 'following', 'according', 'pertaining', 'relating', 'describing', 'indicating', 'showing', 'containing']);
const LABEL_TAIL_DROP = new Set([...LABEL_STOP, ...LABEL_SKIP, 'the', 'a', 'an']);

/** A label reads as a phrase: 2–4 words and no dangling last word. */
export function isCleanLabel(label: string): boolean {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return !dangling(words[words.length - 1]);
}

/** A word a label must not end with: stop words, vague words and participles ("caused", "detailing"). */
function dangling(word: string): boolean {
  const w = word.toLowerCase();
  const participle = (/[a-z]{3,}ed$/.test(w) && !/eed$/.test(w)) || PARTICIPLE_ING.has(w);
  return participle || BAD_END.has(w) || LABEL_TAIL_DROP.has(w);
}

/** Cut an O*NET phrase to at most 4 words at a clean boundary (before a preposition, never after an adjective). */
export function cutPhrase(phrase: string): string {
  const words = phrase.replace(/\.$/, '').replace(/,/g, ' ,').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w === ',' || (out.length >= 1 && LABEL_STOP.has(w.toLowerCase()))) break;
    out.push(w);
    if (out.length === 4) break;
  }
  while (out.length > 1 && dangling(out[out.length - 1])) out.pop();
  return out.join(' ');
}

/**
 * Short label without a model: the task's O*NET detailed work activity when it is short (DWAs are curated
 * phrases such as "Record patient medical histories"), else shortLabel(text) when it reads as a phrase, else the
 * best DWA cut at a clean boundary. Never a fragment such as "Perform duties related".
 */
export function shortFromTask(text: string, dwaTitles: readonly string[] = []): string {
  const taskWords = new Set(normTitle(text).main.split(' '));
  const overlap = (d: string) => normTitle(d).main.split(' ').filter((w) => taskWords.has(w)).length;
  const dwas = [...dwaTitles].map((d) => d.replace(/\.$/, '').trim()).filter(Boolean);
  const ranked = dwas.map((d, i) => ({ d, i, o: overlap(d) })).sort((a, b) => b.o - a.o || a.i - b.i);
  const shortDwa = ranked.find((x) => isCleanLabel(x.d));
  if (shortDwa) return shortDwa.d;
  const h = shortLabel(text);
  if (isCleanLabel(h)) return h;
  for (const x of ranked) {
    const c = cutPhrase(x.d);
    if (isCleanLabel(c)) return c;
  }
  const c = cutPhrase(text);
  if (isCleanLabel(c)) return c;
  // Last resort: the heuristic without dangling words at the end ("Discuss with client the" → "Discuss with client").
  const words = h.split(' ').filter(Boolean);
  while (words.length > 1 && dangling(words[words.length - 1])) words.pop();
  return words.join(' ') || c;
}
