import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSearchIndex, type LoadedSearchIndex, type SearchIndexFile } from '@/domain/search';
import { normTitle } from '@/domain/text';
import type { Locale, OccupationBundle, OccupationIndexEntry, TitleIndexEntry } from '@/domain/types';

/**
 * Read-only access to the built data on the server: occupation bundles (public/data/occ, the same
 * files the CDN serves to the browser), the search index and the title lists. Everything is read from
 * the file system once per instance and kept in memory; the files only change with a new deployment.
 * Tracing: next.config `outputFileTracingIncludes` must list data/build/** and public/data/occ/**.
 */

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, 'data', 'build');
const OCC_DIR = path.join(ROOT, 'public', 'data', 'occ');

export const OCC_CODE_RE = /^\d{2}-\d{4}\.\d{2}$/;
export const isOccupationCode = (v: unknown): v is string => typeof v === 'string' && OCC_CODE_RE.test(v);

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= load().catch((err) => {
      p = null; // a failed read is retried on the next request instead of being cached forever
      throw err;
    });
    return p;
  };
}

// ---------------------------------------------------------------------------------------------
// Occupation index and bundles

export const getOccupationIndex = once(async () => {
  const list = await readJsonFile<OccupationIndexEntry[]>(path.join(BUILD_DIR, 'index.json'));
  return new Map(list.map((e) => [e.code, e]));
});

const BUNDLE_CACHE_MAX = 200;
const bundleCache = new Map<string, Promise<OccupationBundle>>();

/** The occupation bundle, or null when the code is malformed or unknown. */
export async function loadBundle(code: string): Promise<OccupationBundle | null> {
  if (!isOccupationCode(code)) return null;
  const index = await getOccupationIndex();
  if (!index.has(code)) return null;
  let p = bundleCache.get(code);
  if (!p) {
    p = readJsonFile<OccupationBundle>(path.join(OCC_DIR, `${code}.json`));
    p.catch(() => bundleCache.delete(code));
    if (bundleCache.size >= BUNDLE_CACHE_MAX) bundleCache.delete(bundleCache.keys().next().value!);
    bundleCache.set(code, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Search index (one MiniSearch per instance)

export const getSearchIndex = once(async (): Promise<LoadedSearchIndex> => {
  const file = await readJsonFile<SearchIndexFile>(path.join(BUILD_DIR, 'search-index.json'));
  return loadSearchIndex(file);
});

// ---------------------------------------------------------------------------------------------
// Translated occupation titles (top occupations): code → first (main) translated title

interface TranslatedTitles {
  items: { code: string; title: string }[];
}

const localTitles: Record<Exclude<Locale, 'en'>, () => Promise<Map<string, string>>> = {
  ru: once(() => loadLocalTitles('ru')),
  kk: once(() => loadLocalTitles('kk')),
};

async function loadLocalTitles(locale: 'ru' | 'kk'): Promise<Map<string, string>> {
  const file = await readJsonFile<TranslatedTitles>(path.join(BUILD_DIR, `titles.${locale}.json`));
  const map = new Map<string, string>();
  for (const it of file.items) if (!map.has(it.code)) map.set(it.code, it.title);
  return map;
}

/** Occupation title in the user's language when the build has a translation, else null. */
export async function getLocalTitles(locale: Locale): Promise<Map<string, string> | null> {
  return locale === 'en' ? null : localTitles[locale]();
}

// ---------------------------------------------------------------------------------------------
// Known job titles as normalised phrases (résumé heuristic)

export interface TitlePhrases {
  /** Normalised titles of 2–4 words, any language. */
  multi: Set<string>;
  /** Normalised one-word titles (nurse, electrician, бухгалтер). */
  single: Set<string>;
}

export const getTitlePhrases = once(async (): Promise<TitlePhrases> => {
  const entries = await readJsonFile<TitleIndexEntry[]>(path.join(BUILD_DIR, 'titles.json'));
  const multi = new Set<string>();
  const single = new Set<string>();
  for (const e of entries) {
    const { main } = normTitle(e.t);
    if (!main) continue;
    const words = main.split(' ');
    if (words.length === 1) {
      if (main.length >= 4) single.add(main);
    } else if (words.length <= 4) {
      multi.add(main);
    }
  }
  return { multi, single };
});
