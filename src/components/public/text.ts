/*
 * Text helpers for the public pages; no model involved.
 */

const STOP_AT = new Set(['and', 'or', 'to', 'for', 'using', 'including', 'such', 'by', 'with', 'in', 'on', 'at', 'from', 'that', 'which', 'as']);

/**
 * Short task label: the task text up to its first clause boundary, at most 5 words. Same rule as the
 * heuristic in src/server/xray/tips.ts, kept here so static pages do not import the AI module.
 */
export function shortLabel(text: string): string {
  const words = text.replace(/[.;:]+\s*$/, '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let listOpen = false; // «Monitor, record, and report …»: a serial list of verbs stays together
  for (const w of words) {
    const bare = w.toLowerCase().replace(/[^a-z']/g, '');
    const joinsList = listOpen && (bare === 'and' || bare === 'or');
    if (out.length >= 2 && STOP_AT.has(bare) && !joinsList) break;
    const endsClause = /[,;:]$/.test(w);
    if (endsClause && out.length < 3) listOpen = true;
    out.push(endsClause && out.length < 3 ? w.replace(/[;:]+$/, '') : w.replace(/[,;:]+$/, ''));
    if (out.length >= 5) break;
    if (endsClause && out.length >= 3 && !listOpen) break;
    if (joinsList) listOpen = false;
  }
  const dangling = (w: string) => STOP_AT.has(w.toLowerCase().replace(/[^a-z']/g, '')) || /^(other|the|a|an)$/i.test(w);
  while (out.length > 2 && dangling(out[out.length - 1])) out.pop();
  if (listOpen) {
    // The list was cut before it closed («Work from ladders, scaffolds or»): keep its first item only,
    // unless the comma separates adjectives («Maintain accurate, detailed reports»).
    const firstComma = out.findIndex((w) => w.endsWith(','));
    const adjective = firstComma >= 0 && /(ate|ful|ive|ous|al|ed),$/.test(out[firstComma]);
    if (firstComma >= 1 && !adjective) return out.slice(0, firstComma + 1).join(' ').replace(/,$/, '');
    while (out.length > 2 && dangling(out[out.length - 1])) out.pop();
  }
  return out.join(' ').replace(/,$/, '');
}

const IRREGULAR: Record<string, string> = {
  women: 'woman',
  men: 'man',
  people: 'person',
  staff: 'staff',
  personnel: 'personnel',
  police: 'police',
  series: 'series',
  analysis: 'analysis',
};

function singularWord(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  if (/(ss|us|is)$/.test(lower)) return lower;
  if (/[^aeiou]ies$/.test(lower)) return lower.slice(0, -3) + 'y';
  if (/(ches|shes|sses|xes|zes)$/.test(lower)) return lower.slice(0, -2);
  if (lower.endsWith('s')) return lower.slice(0, -1);
  return lower;
}

/**
 * «Registered Nurses» → «a registered nurse»; «Electricians» → «an electrician». O*NET titles are
 * plural; titles with commas or several roles («Bookkeeping, Accounting, and Auditing Clerks») do not
 * singularise cleanly, so they return null and the caller uses the full title instead.
 */
export function singularPhrase(title: string): string | null {
  if (/[,()/]/.test(title) || /\band\b|\bor\b|\bexcept\b/i.test(title)) return null;
  const words = title.trim().split(/\s+/);
  if (words.length > 4) return null;
  const last = words[words.length - 1];
  if (!/s$/i.test(last)) return null;
  const head = words.slice(0, -1).map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()));
  const phrase = [...head, singularWord(last)].join(' ');
  const article = /^[aeiou]/i.test(phrase) && !/^(uni|use|eu)/i.test(phrase) ? 'an' : 'a';
  return `${article} ${phrase}`;
}

/** «a registered nurse» → «registered nurse's» possessive without the article. */
export function possessive(phrase: string): string {
  return `${phrase}'s`;
}

/** The task's short label from the bundle (model-written for top occupations), else the heuristic. */
export function taskShort(task: { text: string; short?: string }): string {
  return task.short?.trim() || shortLabel(task.text);
}
