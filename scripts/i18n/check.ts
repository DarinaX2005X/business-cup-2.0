import { locales, type Locale } from '../../src/i18n/config';
import { expectedKeys, flat, listSections, placeholders, readTree, writeCatalog } from './lib';

/**
 * npm run i18n:check
 * The product is English only (ROUND3, decision 1), so the script checks the English dictionaries:
 * every section has a readable `<section>.en.json`, no empty texts, every plural group has its `_other`
 * form, and no plural form uses a placeholder its `_other` form lacks. It also refreshes src/i18n/catalog/*.ts.
 * RU/KK files may stay in the repo unused; they are not checked. Exits 1 on any problem.
 */

/**
 * Sections that exist only in English by product decision (kept for `checkDictionaries`, the full
 * translation check that tests still exercise).
 */
export const ENGLISH_ONLY_SECTIONS: readonly string[] = ['jobs'];

const PLURAL_RE = /_(zero|one|two|few|many|other)$/;

/** The English-only check run by `npm run i18n:check`. */
export function checkEnglish(only?: string[]): { problems: string[]; keys: number } {
  const problems: string[] = [];
  let keys = 0;
  for (const [section, present] of listSections()) {
    if (only && !only.includes(section)) continue;
    if (!present.has('en')) {
      problems.push(`${section}: no English file ${section}.en.json`);
      continue;
    }
    let tree: ReturnType<typeof readTree>;
    try {
      tree = readTree(section, 'en');
    } catch (err) {
      problems.push(`${section}.en: not valid JSON (${(err as Error).message})`);
      continue;
    }
    const en = flat(tree);
    keys += Object.keys(en).length;
    const groups = new Map<string, string[]>();
    for (const [key, text] of Object.entries(en)) {
      if (typeof text !== 'string' || text.trim() === '') problems.push(`${section}.en: "${section}.${key}" is empty`);
      if (PLURAL_RE.test(key)) {
        const base = key.replace(PLURAL_RE, '');
        groups.set(base, [...(groups.get(base) ?? []), key]);
      }
    }
    for (const [base, forms] of groups) {
      const other = `${base}_other`;
      if (!(other in en)) {
        problems.push(`${section}.en: plural "${section}.${base}" has no _other form`);
        continue;
      }
      // a singular form may leave {count} out («one task»), but never use a placeholder the _other form lacks
      const allowed = new Set(placeholders(en[other]));
      for (const form of forms) {
        const extra = placeholders(en[form]).filter((p) => !allowed.has(p));
        if (extra.length) problems.push(`${section}.en: "${section}.${form}" uses {${extra.join(',')}} that _other doesn't have`);
      }
    }
  }
  return { problems, keys };
}

/**
 * The former full translation check (every English key present in RU and KK with the same placeholders).
 * Not run by `npm run i18n:check` any more; kept for tests and in case other languages come back.
 */
export function checkDictionaries(only?: string[]): { problems: string[]; drafts: number; keys: number } {
  const problems: string[] = [];
  let drafts = 0;
  let keys = 0;
  for (const [section, present] of listSections()) {
    if (only && !only.includes(section)) continue;
    if (!present.has('en')) {
      problems.push(`${section}: no English file ${section}.en.json`);
      continue;
    }
    const en = flat(readTree(section, 'en'));
    if (ENGLISH_ONLY_SECTIONS.includes(section)) {
      keys += Object.keys(en).length;
      for (const l of present) if (l !== 'en') problems.push(`${section}.${l}: section is English only, remove ${section}.${l}.json`);
      continue;
    }
    keys += Object.keys(en).length;
    for (const locale of locales.filter((l): l is Exclude<Locale, 'en'> => l !== 'en')) {
      const tree = readTree(section, locale);
      if (!tree) {
        problems.push(`${section}.${locale}: file missing (npm run i18n:translate -- --section ${section})`);
        continue;
      }
      if (Array.isArray(tree._draft)) drafts += tree._draft.length;
      const have = flat(tree);
      const expected = expectedKeys(en, locale);
      for (const [key, { source }] of expected) {
        if (!(key in have)) {
          problems.push(`${section}.${locale}: missing "${section}.${key}"`);
          continue;
        }
        const want = placeholders(source).join(',');
        const got = placeholders(have[key]).join(',');
        if (want !== got) problems.push(`${section}.${locale}: "${section}.${key}" placeholders {${got}} differ from English {${want}}`);
      }
      for (const key of Object.keys(have)) {
        if (!expected.has(key)) problems.push(`${section}.${locale}: extra key "${section}.${key}" (not in English)`);
      }
    }
  }
  return { problems, drafts, keys };
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/i18n/check.ts');
if (isMain) {
  const { changed } = writeCatalog();
  if (changed.length) console.log(`catalog updated: ${changed.join(', ')}`);
  const { problems, keys } = checkEnglish();
  if (problems.length) {
    console.error(`i18n:check found ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`i18n:check OK: ${keys} English keys (English only)`);
}
