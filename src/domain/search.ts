import MiniSearch, { type SearchResult } from 'minisearch';
import { normQuery, normTitle } from './text';
import type { Locale, TitleIndexEntry } from './types';

// One search configuration for the build (index) and the route (query). PLAN «Механизм карты недели» step 1:
// aliases ×3, primary ×2, alternate ×1.3; prefix on the last word; fuzzy 0.2 for words longer than 4 letters;
// grouped by occupation; up to 8 results.

export const SEARCH_INDEX_VERSION = 2;

const FIELD_BY_KIND: Record<TitleIndexEntry['k'], 'alias' | 'primary' | 'alt'> = {
  alias: 'alias',
  primary: 'primary',
  alt: 'alt',
  reported: 'alt',
};
const BOOST = { alias: 3, primary: 2, alt: 1.3, extra: 0.6 };
/** Popularity only separates near-equal matches (e.g. "nurse" → Registered Nurses first). */
const POPULARITY_WEIGHT = 0.08;

interface SearchDoc {
  id: number;
  alias?: string;
  primary?: string;
  alt?: string;
  extra?: string;
  c: string;
  t: string;
  k: TitleIndexEntry['k'];
  l?: TitleIndexEntry['l'];
}

const MINI_OPTIONS = {
  fields: ['alias', 'primary', 'alt', 'extra'],
  storeFields: ['c', 't', 'k', 'l'],
};

export interface SearchIndexFile {
  version: number;
  /** code → primary O*NET title */
  titles: Record<string, string>;
  /** code → 0..1 popularity (1 = most employed) */
  popularity: Record<string, number>;
  index: unknown; // MiniSearch.toJSON()
}

export interface LoadedSearchIndex {
  mini: MiniSearch<SearchDoc>;
  titles: Record<string, string>;
  popularity: Record<string, number>;
}

export interface OccupationHit {
  code: string;
  title: string;
  matched: string;
  kind: TitleIndexEntry['k'];
  score: number;
  /** 0..1 share of the query this hit explains (exact word 1, prefix 0.9, typo 1 − edits/length) */
  confidence: number;
  /** The same over the query's content words only ("happiness" in "chief happiness officer"). */
  contentConfidence?: number;
}

/** Build time: index every title entry. Entries must already be deduplicated and in a stable order. */
export function buildSearchIndex(
  entries: readonly TitleIndexEntry[],
  titles: Record<string, string>,
  popularity: Record<string, number>,
): SearchIndexFile {
  const mini = new MiniSearch<SearchDoc>(MINI_OPTIONS);
  const docs: SearchDoc[] = entries.map((e, id) => {
    const { main, paren } = normTitle(e.t);
    const doc: SearchDoc = { id, c: e.c, t: e.t, k: e.k };
    if (e.l) doc.l = e.l;
    doc[FIELD_BY_KIND[e.k]] = main;
    if (paren) doc.extra = paren;
    return doc;
  });
  mini.addAll(docs);
  return { version: SEARCH_INDEX_VERSION, titles, popularity, index: mini.toJSON() };
}

/** Route: load once per cold start from data/build/search-index.json. */
export function loadSearchIndex(file: SearchIndexFile): LoadedSearchIndex {
  if (file.version !== SEARCH_INDEX_VERSION) throw new Error(`search index version ${file.version}, expected ${SEARCH_INDEX_VERSION}`);
  const mini = MiniSearch.loadJSON<SearchDoc>(JSON.stringify(file.index), MINI_OPTIONS);
  return { mini, titles: file.titles, popularity: file.popularity };
}

function runQuery(idx: LoadedSearchIndex, q: string): SearchResult[] {
  return idx.mini.search(q, {
    boost: BOOST,
    prefix: (_term, i, terms) => i === terms.length - 1,
    fuzzy: (term) => (term.length > 4 ? 0.2 : false),
  });
}

/** Longest query the domain accepts; longer input is cut, never rejected. */
export const MAX_QUERY_LENGTH = 100;
/**
 * A result is trusted when the matched query words cover enough of the query: exact word 1, prefix 0.9,
 * typo 1 − edits/length. Calibrated on the build (tests/domain/search.test.ts): every real title in the test
 * table scores >= 0.85, keyboard mashes score 0.
 */
export const MIN_CONFIDENCE = 0.6;
/** Share of the query's content words (not generic job words) a confident hit must explain. */
export const MIN_CONTENT_CONFIDENCE = 0.5;
/** A single word counts as a strong match for suggestions at this quality (exact or prefix). */
const STRONG_TERM = 0.9;

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** How well one query word matched one result: exact 1, prefix 0.9, typo 1 − edits/length, none 0. */
function termQuality(queryTerm: string, docTerms: string[]): number {
  let best = 0;
  for (const d of docTerms) {
    if (d === queryTerm) return 1;
    if (d.startsWith(queryTerm)) best = Math.max(best, 0.9);
    else best = Math.max(best, 1 - levenshtein(queryTerm, d) / Math.max(queryTerm.length, 1));
  }
  return best;
}

/** Share of the query explained by this result, 0..1. */
function confidenceOf(r: SearchResult, tokens: string[]): number {
  if (!tokens.length) return 0;
  const docTerms = Object.keys(r.match);
  let sum = 0;
  for (const t of tokens) if (r.queryTerms.includes(t)) sum += termQuality(t, docTerms);
  return sum / tokens.length;
}

/** Job words that say little on their own: a hit must explain the other words of the query. */
const GENERIC_WORDS = new Set([
  'officer', 'chief', 'manager', 'specialist', 'assistant', 'associate', 'worker', 'clerk', 'representative', 'rep',
  'technician', 'coordinator', 'agent', 'operator', 'director', 'head', 'staff', 'executive', 'consultant', 'administrator',
  'менеджер', 'специалист', 'помощник', 'ассистент', 'сотрудник', 'работник', 'агент', 'оператор', 'директор', 'руководитель',
  'начальник', 'главный', 'старший', 'маманы', 'менеджері', 'көмекшісі', 'қызметкері', 'жетекшісі', 'басшысы',
]);

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Group hits by occupation. With a locale, titles in the other Cyrillic language count less (0.6) and the
 * `matched` text shown is in the request's locale or English; when only another language matched, `matched`
 * is the English occupation title.
 */
function group(idx: LoadedSearchIndex, results: SearchResult[], limit: number, tokens: string[], locale?: Locale): OccupationHit[] {
  const content = tokens.filter((t) => !GENERIC_WORDS.has(t));
  const best = new Map<string, OccupationHit>();
  const shown = new Map<string, SearchResult>();
  for (const r of results) {
    const code = r.c as string;
    const lang = r.l as TitleIndexEntry['l'] | undefined;
    // Only Russian and Kazakh requests filter the shown title; an English request shows whatever was typed.
    const displayable = !locale || locale === 'en' || !lang || lang === locale;
    const score = locale && lang && lang !== locale && locale !== 'en' ? r.score * 0.6 : r.score;
    const prev = best.get(code);
    if (!prev || score > prev.score) {
      best.set(code, {
        code,
        title: idx.titles[code] ?? code,
        matched: r.t as string,
        kind: r.k as TitleIndexEntry['k'],
        score,
        confidence: round3(confidenceOf(r, tokens)),
        contentConfidence: round3(content.length ? confidenceOf(r, content) : confidenceOf(r, tokens)),
      });
    }
    const prevShown = shown.get(code);
    if (displayable && (!prevShown || r.score > prevShown.score)) shown.set(code, r);
  }
  for (const [code, hit] of best) {
    const d = shown.get(code);
    if (d) {
      hit.matched = d.t as string;
      hit.kind = d.k as TitleIndexEntry['k'];
    } else if (locale) {
      hit.matched = idx.titles[code] ?? code;
      hit.kind = 'primary';
    }
  }
  const ranked = [...best.values()].map((h) => ({ ...h, score: h.score * (1 + POPULARITY_WEIGHT * (idx.popularity[h.code] ?? 0)) }));
  ranked.sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));
  return ranked.slice(0, limit).map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
}

/**
 * Search occupations by job title (any of the 3 languages present in the index). Safe on any input: non-strings
 * and empty input give no results, input longer than 100 characters is cut.
 * `confident` is false when the best hit explains less than MIN_CONFIDENCE of the query; then `results` is empty
 * and `suggestions` holds occupations for single words that matched strongly (exact or prefix).
 */
export function searchOccupations(
  idx: LoadedSearchIndex,
  query: string,
  limit = 8,
  locale?: Locale,
): { results: OccupationHit[]; suggestions: { code: string; title: string }[]; confident: boolean; score: number } {
  const q = normQuery(typeof query === 'string' ? query.slice(0, MAX_QUERY_LENGTH) : '');
  if (!q) return { results: [], suggestions: [], confident: false, score: 0 };
  const tokens = [...new Set(q.split(' '))];
  const results = group(idx, runQuery(idx, q), limit, tokens, locale);
  const top = results[0];
  // A confident hit explains enough of the query and at least half of its content words, so
  // "chief happiness officer" is not answered with Chief Executives or Police Officers.
  const strong = (r: OccupationHit) => r.confidence >= MIN_CONFIDENCE && (r.contentConfidence ?? 1) >= MIN_CONTENT_CONFIDENCE;
  const confident = !!top && results.some(strong);
  if (confident) {
    return { results: results.filter((r) => r.confidence >= MIN_CONFIDENCE / 2), suggestions: [], confident, score: top.score };
  }
  const suggestions: { code: string; title: string }[] = [];
  for (const word of tokens) {
    if (word.length < 3) continue;
    const hit = group(idx, runQuery(idx, word), 1, [word], locale)[0];
    if (hit && hit.confidence >= STRONG_TERM && !suggestions.some((s) => s.code === hit.code)) suggestions.push({ code: hit.code, title: hit.title });
  }
  return { results: [], suggestions: suggestions.slice(0, 5), confident: false, score: top?.score ?? 0 };
}
