import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadEnv } from '../ai/load-env';
import { expectedKeys, flat, listSections, placeholders, readTree, setPath, writeCatalog, writeTree, type Tree } from './lib';

/**
 * npm run i18n:translate -- --section today [--locale ru|kk] [--max-usd 0.3] [--dry]
 * Drafts the missing RU/KK keys of a section with the model, using scripts/i18n/glossary.json.
 * New keys are listed in the file's "_draft" array for human review (stage 06.2).
 * Results are cached by input, so rerunning costs nothing; spending stops at --max-usd.
 */
loadEnv();

type Target = 'ru' | 'kk';
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
};

const BATCH = 40;

const resultSchema = z.object({
  items: z.array(z.object({ id: z.string(), ru: z.string().nullable(), kk: z.string().nullable() })),
});

interface Glossary {
  terms: { en: string; ru: string; kk: string; note?: string }[];
}

function systemPrompt(glossary: Glossary): string {
  const terms = glossary.terms.map((t) => `- "${t.en}" → ru "${t.ru}", kk "${t.kk}"${t.note ? ` (${t.note})` : ''}`).join('\n');
  return [
    'You translate interface text of Irreplaceable, a web app for working professionals: it shows which tasks of their job AI already does and trains them daily on the parts AI gets wrong.',
    'Translate each English string into Russian (ru) and Kazakh (kk, Cyrillic script) as a native product writer would: plain, friendly, full sentences, natural spoken wording, polite "вы"/"сіз" form. No literal calques, no bureaucratic phrasing, no added words.',
    'Keep every placeholder in curly braces exactly as in the source, including any ", number"/", date" suffix. Keep numbers, punctuation style and capitalisation habits of the target language (sentence case for buttons and headings).',
    'Some items are a specific plural form; the note says which (Intl.PluralRules category). Write the form that agrees with such a count.',
    'Return null for a language when the item says that language is not needed.',
    'Use these fixed terms:',
    terms,
  ].join('\n');
}

async function main() {
  const { callModel, isAiError } = await import('@/server/ai/client');
  // `--section x`, `--section=x` or a bare `x` (PowerShell's npm shim drops flags after `--`)
  const section = opt('section') ?? args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const only = opt('locale') as Target | undefined;
  const maxUsd = Number(opt('max-usd') ?? 0.3);
  const dry = args.includes('--dry');
  const sections = listSections();
  if (!section || !sections.has(section)) {
    console.error(`Usage: npm run i18n:translate -- --section <name>. Sections: ${[...sections.keys()].join(', ') || 'none'}`);
    process.exit(1);
  }
  const targets: Target[] = only ? [only] : ['ru', 'kk'];
  const glossary = JSON.parse(readFileSync(path.join(process.cwd(), 'scripts', 'i18n', 'glossary.json'), 'utf8')) as Glossary;
  const en = flat(readTree(section, 'en'));

  const trees: Record<Target, Tree> = { ru: readTree(section, 'ru') ?? {}, kk: readTree(section, 'kk') ?? {} };
  const needed = new Map<string, { source: string; plural?: Partial<Record<Target, string>>; langs: Set<Target> }>();
  for (const locale of targets) {
    const have = flat(trees[locale]);
    for (const [key, info] of expectedKeys(en, locale)) {
      if (key in have) continue;
      const item = needed.get(key) ?? { source: info.source, langs: new Set<Target>(), plural: {} };
      item.langs.add(locale);
      if (info.plural) item.plural![locale] = info.plural;
      needed.set(key, item);
    }
  }
  if (needed.size === 0) {
    console.log(`${section}: nothing to translate`);
    writeCatalog();
    return;
  }
  console.log(`${section}: ${needed.size} key(s) to draft for ${targets.join(', ')}${dry ? ' (dry run)' : ''}`);
  if (dry) {
    for (const [k, v] of needed) console.log(`  ${k} [${[...v.langs].join(',')}]`);
    return;
  }

  const entries = [...needed.entries()];
  let spent = 0;
  let written = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    if (spent >= maxUsd) {
      console.warn(`Stopped: spent $${spent.toFixed(4)} reached --max-usd ${maxUsd}. Rerun to continue.`);
      break;
    }
    const batch = entries.slice(i, i + BATCH);
    const items = batch.map(([key, v], idx) => ({
      id: String(idx),
      source: v.source,
      need: [...v.langs],
      note: v.plural && Object.keys(v.plural).length ? `plural form: ${Object.entries(v.plural).map(([l, c]) => `${l}=${c}`).join(', ')}` : undefined,
      key: `${section}.${key}`,
    }));
    const user = `Translate these items. "need" lists the languages to return; return null for the others.\n${JSON.stringify(items, null, 1)}`;
    try {
      const res = await callModel({
        op: 'i18n.translate',
        schema: resultSchema,
        system: systemPrompt(glossary),
        user,
        locale: 'en',
        cacheKey: user,
        maxTokens: 400 + batch.length * 160,
        temperature: 0.2,
      });
      spent += res.usage.costUsd;
      for (const out of res.data.items) {
        const entry = batch[Number(out.id)];
        if (!entry) continue;
        const [key, v] = entry;
        for (const locale of v.langs) {
          const text = out[locale];
          if (!text) {
            console.warn(`  ${locale} ${key}: no translation returned`);
            continue;
          }
          if (placeholders(text).join(',') !== placeholders(v.source).join(',')) {
            console.warn(`  ${locale} ${key}: placeholders changed, skipped`);
            continue;
          }
          setPath(trees[locale], key, text);
          const draft = new Set<string>(Array.isArray(trees[locale]._draft) ? (trees[locale]._draft as string[]) : []);
          draft.add(key);
          trees[locale]._draft = [...draft].sort();
          written++;
        }
      }
      console.log(`  batch ${i / BATCH + 1}: ${res.cached ? 'cached' : `$${res.usage.costUsd.toFixed(5)}`}`);
    } catch (err) {
      if (isAiError(err)) {
        console.error(`Model call failed (${err.code}): ${err.message}. Already drafted keys are saved.`);
        break;
      }
      throw err;
    }
  }

  for (const locale of targets) writeTree(section, locale, trees[locale]);
  writeCatalog();
  console.log(`${section}: drafted ${written} translation(s), spent $${spent.toFixed(5)}. Review keys listed in "_draft".`);
}

main();
