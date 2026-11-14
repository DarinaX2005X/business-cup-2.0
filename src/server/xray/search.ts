import { searchOccupations, type LoadedSearchIndex, type OccupationHit } from '@/domain/search';
import { hasCyrillic, normQuery, normTitle } from '@/domain/text';
import type { Locale, TitleIndexEntry } from '@/domain/types';
import { dayKey, hashIp, type Actor } from '@/server/ai/budget';
import { AiError, callModel, isAiError } from '@/server/ai/client';
import { cacheStoreKey } from '@/server/ai/cache';
import { getStore } from '@/server/store';
import { titleTranslatePrompt, titleTranslateSchema } from '@/server/ai/prompts/title-translate';
import { getLocalTitles, getSearchIndex } from './data';

/**
 * Occupation search for GET /api/occupations/search (02.1.1).
 * 1. The built index (English titles, aliases, Russian and Kazakh translations of the top occupations).
 * 2. Cyrillic with no or partial hit → `title.translate` (cached, temperature 0) → search the English title.
 * 3. Results are shown only when the top hit is a confident match for the words typed; otherwise
 *    `results: []` and `suggestions` that each match a real word of the query (the UI then says
 *    "We couldn't find …" and offers "Describe your work instead").
 */

export const SEARCH_LIMIT = 8;
export const SUGGESTION_LIMIT = 3;
export const QUERY_MIN = 2;
/** Longer queries are cut to this length (at a word boundary when possible) and searched. */
export const QUERY_MAX = 100;

export interface SearchResultItem {
  code: string;
  /** O*NET occupation title (English). */
  title: string;
  /** The title that matched the query, e.g. "RN" for Registered Nurses. */
  matched: string;
  kind: TitleIndexEntry['k'];
  /** Translated occupation title for ru/kk when the build has one. */
  localTitle: string | null;
}

export interface SearchResponse {
  results: SearchResultItem[];
  suggestions: { code: string; title: string; localTitle: string | null }[];
  /** English title the model translated a Cyrillic query to, when that path was used. */
  translated: string | null;
  /** 'try_english': translation was unavailable (budget, limits, provider) — the UI asks for the English title. */
  hint: 'try_english' | null;
  /**
   * true when the query is Cyrillic, has no confident local match and translation was not requested
   * (translate=0 while typing): asking again with translate=1 may find it. Absent otherwise.
   */
  translatable?: boolean;
}

export interface SearchOptions {
  /** Allow the model translation of a Cyrillic query (default true). The client sends false while typing. */
  translate?: boolean;
}

export function clampQuery(query: string): string {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length <= QUERY_MAX) return q;
  const cut = q.slice(0, QUERY_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > QUERY_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

type DomainSearch = ReturnType<typeof searchOccupations> & { confident?: boolean };

export async function searchTitles(rawQuery: string, locale: Locale, actor?: Actor, options: SearchOptions = {}): Promise<SearchResponse> {
  const query = clampQuery(rawQuery);
  const idx = await getSearchIndex();
  const local = await getLocalTitles(locale);
  const localOf = (code: string) => local?.get(code) ?? null;
  const shape = (hits: OccupationHit[]): SearchResultItem[] =>
    hits.map((h) => ({ code: h.code, title: h.title, matched: h.matched, kind: h.kind, localTitle: localOf(h.code) }));
  const search = (q: string) => searchOccupations(idx, q, SEARCH_LIMIT) as DomainSearch;
  // The domain flag (when the data package provides it) and the word check must both agree.
  const confident = (q: string, r: DomainSearch) => r.results.length > 0 && r.confident !== false && matchesQuery(q, r.results[0].matched);
  const suggest = (...queries: string[]) => {
    const out: SearchResponse['suggestions'] = [];
    for (const q of queries) {
      for (const s of wordSuggestions(idx, q)) {
        if (out.length < SUGGESTION_LIMIT && !out.some((o) => o.code === s.code)) out.push({ ...s, localTitle: localOf(s.code) });
      }
    }
    return out;
  };
  const none = (hint: SearchResponse['hint'], ...suggestFrom: string[]): SearchResponse => ({
    results: [],
    suggestions: suggest(...suggestFrom),
    translated: null,
    hint,
  });

  const first = search(query);
  if (!hasCyrillic(query)) {
    return confident(query, first) ? { results: shape(first.results), suggestions: [], translated: null, hint: null } : none(null, query);
  }

  // Cyrillic: the translated titles cover the top occupations only, so a missing or partial match
  // goes through translation ("крановщик" must not stop at the typo match "кладовщик").
  const original = shape(first.results);
  if (original.length && first.confident !== false && coversQuery(query, original[0].matched)) {
    return { results: original, suggestions: [], translated: null, hint: null };
  }

  if (options.translate === false) return { ...none(null, query), translatable: normQuery(query).length >= 3 };

  let english: string | null;
  try {
    english = await translateTitle(query, locale, actor);
  } catch (err) {
    if (!isAiError(err)) throw err;
    return none('try_english', query);
  }
  if (!english) return none(null, query);

  const second = search(english);
  if (!confident(english, second)) return none(null, english, query);
  // Translated matches first, then whatever the Cyrillic index found.
  const merged = shape(second.results);
  for (const r of original) if (merged.length < SEARCH_LIMIT && !merged.some((m) => m.code === r.code)) merged.push(r);
  return { results: merged, suggestions: [], translated: english, hint: null };
}

/** Words that carry no job meaning in a query. */
const FILLER = new Set([
  'i', 'im', 'me', 'my', 'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'at', 'for', 'with', 'on', 'as', 'do', 'am', 'is', 'like', 'work', 'job',
  'я', 'и', 'в', 'на', 'по', 'с', 'мен', 'және',
]);

const meaningfulWords = (query: string) => normQuery(query).split(' ').filter((w) => w && !FILLER.has(w));

function titleWords(matched: string): string[] {
  const { main, paren } = normTitle(matched);
  return `${main} ${paren}`.split(' ').filter(Boolean);
}

/** How a query word appears in a title: same stem (first max(4, length − 2) letters), the start of a word being typed, or a small typo. */
function wordMatch(w: string, target: string[], typing: boolean): 'stem' | 'typo' | null {
  const stem = w.length < 4 ? w : w.slice(0, Math.max(4, w.length - 2));
  if (target.some((t) => (w.length < 4 ? t === w : t.startsWith(stem)) || (typing && w.length >= 2 && t.startsWith(w)))) return 'stem';
  const maxEdits = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0;
  if (maxEdits && target.some((t) => Math.abs(t.length - w.length) <= maxEdits && editDistance(w, t, maxEdits) <= maxEdits)) return 'typo';
  return null;
}

/**
 * Is the matched title a real answer to what was typed? Every meaningful word for one or two words,
 * more than half for longer queries, must appear in it by stem or as a small typo (the last word may
 * still be being typed). "xyzzy qwerty", "lorem ipsum dolor" (dolor ≈ donor) and "hello world" fail.
 */
export function matchesQuery(query: string, matched: string): boolean {
  const words = meaningfulWords(query);
  if (!words.length) return false;
  const target = titleWords(matched);
  const hits = words.filter((w, i) => wordMatch(w, target, i === words.length - 1) !== null).length;
  return words.length <= 2 ? hits === words.length : hits / words.length > 0.5;
}

/** Best occupation for each meaningful word, only when that word really appears (by stem) in its title. */
function wordSuggestions(idx: LoadedSearchIndex, query: string): { code: string; title: string }[] {
  const out: { code: string; title: string }[] = [];
  for (const w of meaningfulWords(query)) {
    if (w.length < 3) continue;
    const hit = searchOccupations(idx, w, 3).results.find((h) => wordMatch(w, titleWords(h.matched), false) === 'stem');
    if (hit && !out.some((o) => o.code === hit.code)) out.push({ code: hit.code, title: hit.title });
  }
  return out;
}

function editDistance(a: string, b: string, cap: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Does the matched title account for every word of the query? Words are compared by stem (the first
 * max(4, length − 2) letters) so Russian endings do not matter; a last word shorter than 4 letters is
 * still being typed and is ignored. "крановщик" matched as "кладовщик" (a typo match) does not cover.
 */
export function coversQuery(query: string, matched: string): boolean {
  const words = normQuery(query).split(' ').filter(Boolean);
  const target = normTitle(matched).main.split(' ').filter(Boolean);
  if (!words.length) return false;
  return words.every((w, i) => {
    if (i === words.length - 1 && w.length < 4) return true;
    const stem = w.slice(0, Math.max(4, w.length - 2));
    return target.some((t) => t.startsWith(stem) || (w.length < 4 && t === w));
  });
}

/** Separate daily allowance for title translation, so typing in Russian cannot use up the visitor's model calls. */
const TRANSLATE_PER_IP_PER_DAY = 300;

/** English job title for a Cyrillic query, or null when the model says it is not a job title. Throws AiError. */
export async function translateTitle(query: string, locale: Locale, actor?: Actor): Promise<string | null> {
  const q = normQuery(query);
  if (q.length < 3) return null;
  await takeTranslateSlot(q, actor);
  const { data } = await callModel({
    op: 'title.translate',
    schema: titleTranslateSchema,
    system: titleTranslatePrompt.system,
    user: titleTranslatePrompt.user(q),
    locale,
    cacheKey: q,
    maxTokens: 120,
    temperature: 0,
  });
  const english = data.isJobTitle ? data.english?.trim() : null;
  if (!english || english.length > 80 || hasCyrillic(english)) return null;
  return english;
}

async function takeTranslateSlot(q: string, actor?: Actor): Promise<void> {
  if (!actor?.ip) return;
  const store = getStore();
  // Cached answers are free: only count queries the cache has not seen.
  const seen = await store.get(cacheStoreKey('title.translate.seen', q));
  if (seen) return;
  const key = `rl:translate:${hashIp(actor.ip)}:${dayKey()}`;
  const n = await store.incrFloat(key, 1, 2 * 24 * 3600);
  if (n > TRANSLATE_PER_IP_PER_DAY) throw new AiError('rate_limited', 'title translation limit for this network today', { op: 'title.translate' });
  await store.set(cacheStoreKey('title.translate.seen', q), 1, { ttlSec: 30 * 24 * 3600 });
}
