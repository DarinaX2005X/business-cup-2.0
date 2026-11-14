import { searchOccupations, type OccupationHit } from '@/domain/search';
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
  const original = shape(first.results);
  // Latin text: the index (with typo tolerance) is the whole answer. Cyrillic: the translated titles
  // cover the top occupations only, so a missing or partial match goes through translation.
  if (!hasCyrillic(query) || (original.length && coversQuery(query, original[0].matched))) {
    return { results: original, suggestions: shapeSuggestions(first.suggestions), translated: null, hint: null };
  }

  let english: string | null;
  try {
    english = await translateTitle(query, locale, actor);
  } catch (err) {
    if (!isAiError(err)) throw err;
    return { results: original, suggestions: shapeSuggestions(first.suggestions), translated: null, hint: 'try_english' };
  }
  if (!english) return { results: original, suggestions: shapeSuggestions(first.suggestions), translated: null, hint: null };

  const second = searchOccupations(idx, english, SEARCH_LIMIT);
  if (!second.results.length) {
    return { results: original, suggestions: shapeSuggestions(original.length ? [] : second.suggestions.length ? second.suggestions : first.suggestions), translated: null, hint: null };
  }
  // Translated matches first, then whatever the Cyrillic index found.
  const merged = [...shape(second.results)];
  for (const r of original) if (merged.length < SEARCH_LIMIT && !merged.some((m) => m.code === r.code)) merged.push(r);
  return { results: merged, suggestions: [], translated: english, hint: null };
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
