import { searchOccupations, type OccupationHit } from '@/domain/search';
import { hasCyrillic, normQuery } from '@/domain/text';
import type { Locale, TitleIndexEntry } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { callModel, isAiError } from '@/server/ai/client';
import { titleTranslatePrompt, titleTranslateSchema } from '@/server/ai/prompts/title-translate';
import { getLocalTitles, getSearchIndex } from './data';

/**
 * Occupation search for GET /api/occupations/search (02.1.1).
 * 1. The built index (English titles, aliases, Russian and Kazakh translations of the top occupations).
 * 2. Cyrillic with no hit → `title.translate` (cached, temperature 0) → search the English title again.
 * 3. Still nothing → `suggestions`: the best occupation for each separate word.
 */

export const SEARCH_LIMIT = 8;
export const SUGGESTION_LIMIT = 3;
export const QUERY_MIN = 2;
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
}

export async function searchTitles(query: string, locale: Locale, actor?: Actor): Promise<SearchResponse> {
  const idx = await getSearchIndex();
  const local = await getLocalTitles(locale);
  const localOf = (code: string) => local?.get(code) ?? null;
  const shape = (hits: OccupationHit[]): SearchResultItem[] =>
    hits.map((h) => ({ code: h.code, title: h.title, matched: h.matched, kind: h.kind, localTitle: localOf(h.code) }));
  const shapeSuggestions = (s: { code: string; title: string }[]) =>
    s.slice(0, SUGGESTION_LIMIT).map((x) => ({ ...x, localTitle: localOf(x.code) }));

  const first = searchOccupations(idx, query, SEARCH_LIMIT);
  if (first.results.length || !hasCyrillic(query)) {
    return { results: shape(first.results), suggestions: shapeSuggestions(first.suggestions), translated: null, hint: null };
  }

  let english: string | null;
  try {
    english = await translateTitle(query, locale, actor);
  } catch (err) {
    if (!isAiError(err)) throw err;
    return { results: [], suggestions: shapeSuggestions(first.suggestions), translated: null, hint: 'try_english' };
  }
  if (!english) return { results: [], suggestions: shapeSuggestions(first.suggestions), translated: null, hint: null };

  const second = searchOccupations(idx, english, SEARCH_LIMIT);
  return {
    results: shape(second.results),
    suggestions: shapeSuggestions(second.results.length ? [] : second.suggestions.length ? second.suggestions : first.suggestions),
    translated: english,
    hint: null,
  };
}

/** English job title for a Cyrillic query, or null when the model says it is not a job title. Throws AiError. */
export async function translateTitle(query: string, locale: Locale, actor?: Actor): Promise<string | null> {
  const q = normQuery(query);
  const { data } = await callModel({
    op: 'title.translate',
    schema: titleTranslateSchema,
    system: titleTranslatePrompt.system,
    user: titleTranslatePrompt.user(q),
    locale,
    cacheKey: q,
    maxTokens: 120,
    temperature: 0,
    reasoning: 'off',
    actor,
  });
  const english = data.isJobTitle ? data.english?.trim() : null;
  if (!english || english.length > 80 || hasCyrillic(english)) return null;
  return english;
}
