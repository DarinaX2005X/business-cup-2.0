import { locales, type Locale } from '../../src/i18n/config';
import { expectedKeys, flat, listSections, placeholders, readTree, writeCatalog } from './lib';

/**
 * npm run i18n:check
 * For every section: each English key exists in RU and KK (with the locale's plural forms),
 * no extra keys, the same placeholders as English. Also refreshes src/i18n/catalog/*.ts.
 * Exits 1 on any problem. Keys listed in "_draft" still count as present (reviewed in 06.2).
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
  const { problems, drafts, keys } = checkDictionaries();
  if (problems.length) {
    console.error(`i18n:check found ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`i18n:check OK: ${keys} English keys, RU and KK complete${drafts ? `, ${drafts} draft translations awaiting review` : ''}`);
}
