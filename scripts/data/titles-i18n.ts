// npm run data:titles-i18n [-- --max-usd=0.2] [-- --top=300] [-- --batch=25]
// Russian and Kazakh job titles for the most employed occupations, written by the model through
// src/server/ai/client.ts (budget, cache, strict schema). Output: data/build/titles.ru.json and titles.kk.json
// ({ model, items: { code, title }[] }). Run `npm run data:build` afterwards: the build adds these titles
// to the search index as `alt` entries with `l: 'ru' | 'kk'`. Results already in the files are kept, so an
// interrupted run continues where it stopped. The hand-written data/aliases.i18n.json works without this.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { OccupationIndexEntry, TitleIndexEntry } from '../../src/domain/types';
import { loadEnv } from '../ai/load-env';

loadEnv();

const ROOT = join(__dirname, '..', '..');
const BUILD = join(ROOT, 'data', 'build');
const arg = (name: string, fallback: number) => {
  const v = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};

const schema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      ru: z.array(z.string()),
      kk: z.array(z.string()),
    }),
  ),
});

const SYSTEM = [
  'You translate US job titles into the job titles people actually use in Russia and Kazakhstan.',
  'For every occupation return 1 to 4 Russian titles in `ru` and 1 to 4 Kazakh titles in `kk`, most common first.',
  'Use the everyday title a person would type into a job search (e.g. "медсестра", "бухгалтер", "мейірбике"), not a literal translation of the long official name.',
  'Kazakh titles are in Kazakh Cyrillic; if Kazakh speakers usually use the Russian word, include it.',
  'Return every input code exactly once. No explanations.',
].join(' ');

type Item = { code: string; title: string };
interface OutFile {
  model: string;
  items: Item[];
}

function readOut(lang: 'ru' | 'kk'): OutFile {
  const p = join(BUILD, `titles.${lang}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as OutFile) : { model: '', items: [] };
}

function writeOut(lang: 'ru' | 'kk', file: OutFile) {
  const seen = new Set<string>();
  const items = file.items
    .filter((i) => {
      const k = `${i.code}|${i.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.title < b.title ? -1 : 1));
  writeFileSync(join(BUILD, `titles.${lang}.json`), JSON.stringify({ model: file.model, items }, null, 1));
}

const valid = (t: string) => t.trim().length > 1 && t.length <= 80 && /[Ѐ-ӿ]/.test(t);

async function main() {
  const maxUsd = arg('max-usd', 0.2);
  const top = arg('top', 300);
  const batchSize = arg('batch', 25);
  const { callModel, getModelId, isAiError } = await import('@/server/ai/client');

  const index = JSON.parse(readFileSync(join(BUILD, 'index.json'), 'utf8')) as OccupationIndexEntry[];
  const titles = JSON.parse(readFileSync(join(BUILD, 'titles.json'), 'utf8')) as TitleIndexEntry[];
  const reported = new Map<string, string[]>();
  for (const t of titles) {
    if (t.k !== 'reported' || t.l) continue;
    if (!reported.has(t.c)) reported.set(t.c, []);
    reported.get(t.c)!.push(t.t);
  }
  const out = { ru: readOut('ru'), kk: readOut('kk') };
  const done = new Set(out.ru.items.map((i) => i.code).filter((c) => out.kk.items.some((k) => k.code === c)));
  const todo = [...index]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, top)
    .filter((o) => !done.has(o.code));
  console.log(`[titles-i18n] model ${getModelId()}, ${todo.length} of top ${top} occupations to translate, budget $${maxUsd}`);

  let spent = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    if (spent >= maxUsd) {
      console.warn(`[titles-i18n] stopped: spent $${spent.toFixed(4)} of $${maxUsd}; run again to continue`);
      break;
    }
    const batch = todo.slice(i, i + batchSize);
    const user = JSON.stringify(
      batch.map((o) => ({ code: o.code, title: o.title, commonTitles: (reported.get(o.code) ?? []).slice(0, 3) })),
    );
    try {
      const res = await callModel({
        op: 'title.i18n',
        schema,
        system: SYSTEM,
        user,
        locale: 'ru',
        cacheKey: user,
        maxTokens: 4000,
        temperature: 0.2,
      });
      spent += res.cached ? 0 : res.usage.costUsd;
      const codes = new Set(batch.map((o) => o.code));
      let added = 0;
      for (const item of res.data.items) {
        if (!codes.has(item.code)) continue; // a code the batch did not ask for is ignored
        for (const t of item.ru.filter(valid).slice(0, 4)) out.ru.items.push({ code: item.code, title: t.trim() });
        for (const t of item.kk.filter(valid).slice(0, 4)) out.kk.items.push({ code: item.code, title: t.trim() });
        added++;
      }
      out.ru.model = out.kk.model = getModelId();
      writeOut('ru', out.ru);
      writeOut('kk', out.kk);
      console.log(`[titles-i18n] ${i + batch.length}/${todo.length}: ${added}/${batch.length} occupations, $${spent.toFixed(4)}${res.cached ? ' (cached)' : ''}`);
    } catch (err) {
      if (isAiError(err)) {
        console.error(`[titles-i18n] stopped on ${err.code}: ${err.message}. Partial results are saved.`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }
  console.log('[titles-i18n] done. Run `npm run data:build` to add the titles to the search index.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
