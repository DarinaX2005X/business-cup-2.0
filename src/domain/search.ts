import MiniSearch, { type SearchResult } from 'minisearch';
import { normQuery, normTitle } from './text';
import type { TitleIndexEntry } from './types';

// One search configuration for the build (index) and the route (query). PLAN «Механизм карты недели» step 1:
// aliases ×3, primary ×2, alternate ×1.3; prefix on the last word; fuzzy 0.2 for words longer than 4 letters;
// grouped by occupation; up to 8 results.

export const SEARCH_INDEX_VERSION = 1;

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
}

const MINI_OPTIONS = {
  fields: ['alias', 'primary', 'alt', 'extra'],
  storeFields: ['c', 't', 'k'],
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

function group(idx: LoadedSearchIndex, results: SearchResult[], limit: number): OccupationHit[] {
  const best = new Map<string, OccupationHit>();
  for (const r of results) {
    const code = r.c as string;
    const prev = best.get(code);
    if (!prev || r.score > prev.score) {
      best.set(code, { code, title: idx.titles[code] ?? code, matched: r.t as string, kind: r.k as TitleIndexEntry['k'], score: r.score });
    }
  }
  const ranked = [...best.values()].map((h) => ({ ...h, score: h.score * (1 + POPULARITY_WEIGHT * (idx.popularity[h.code] ?? 0)) }));
  ranked.sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));
  return ranked.slice(0, limit).map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }));
}

/**
 * Search occupations by job title (any of the 3 languages present in the index).
 * Returns grouped hits; when nothing matches, `suggestions` holds the best occupation for each word.
 */
export function searchOccupations(
  idx: LoadedSearchIndex,
  query: string,
  limit = 8,
): { results: OccupationHit[]; suggestions: { code: string; title: string }[] } {
  const q = normQuery(query);
  if (!q) return { results: [], suggestions: [] };
  const results = group(idx, runQuery(idx, q), limit);
  if (results.length) return { results, suggestions: [] };
  const suggestions: { code: string; title: string }[] = [];
  for (const word of q.split(' ')) {
    if (word.length < 3) continue;
    const hit = group(idx, idx.mini.search(word, { boost: BOOST, prefix: true, fuzzy: 0.3 }), 1)[0];
    if (hit && !suggestions.some((s) => s.code === hit.code)) suggestions.push({ code: hit.code, title: hit.title });
  }
  return { results: [], suggestions: suggestions.slice(0, 5) };
}
