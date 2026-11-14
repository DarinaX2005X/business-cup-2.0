// npx tsx scripts/data/titles-primary.ts [--top=150] [--max-usd=0.1]
// Draft of the main Russian and Kazakh title for the most employed occupations: the everyday, neutral title a
// person would put on a CV ("медсестра", not "медбрат" or "старшая медсестра"). The model only drafts; the
// result goes to data/titles-primary.json, which is reviewed by hand and committed. Entries already in that
// file are kept (a reviewed title is never overwritten). The build puts these titles first in
// data/build/titles.<lang>.json, so the UI shows them as the occupation's local name, and adds them to search.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { OccupationIndexEntry } from '../../src/domain/types';
import { loadEnv } from '../ai/load-env';

loadEnv();

const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'data', 'titles-primary.json');
const arg = (name: string, fallback: number) => {
  const v = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return v === undefined ? fallback : Number(v);
};

const schema = z.object({ items: z.array(z.object({ code: z.string(), ru: z.string(), kk: z.string() })) });

const SYSTEM = [
  'For each US occupation give the one job title people in Russia (ru) and Kazakhstan (kk, in Kazakh Cyrillic) use for it in everyday speech and on a CV.',
  'Use the standard dictionary form. Do not use seniority or rank words (senior, chief, главный, старший, аға, бас).',
  'Use the gender-neutral or standard form: for registered nurses the standard term is «медсестра» / «мейірбике», never «медбрат».',
  'Kazakh titles must be Kazakh words unless Kazakh speakers normally use the Russian or international word (бухгалтер, кассир, бариста).',
  'Translate what the occupation is, not a narrower specialty: Retail Salespersons → «продавец», not a manager.',
  'The candidate titles are suggestions and may be wrong. Return every input code once; no explanations.',
].join(' ');

interface Primary {
  ru: string;
  kk: string;
  source: 'model' | 'reviewed';
}

async function main() {
  const top = arg('top', 150);
  const maxUsd = arg('max-usd', 0.1);
  const { callModel } = await import('@/server/ai/client');
  const index = (JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'index.json'), 'utf8')) as OccupationIndexEntry[]).sort((a, b) => a.rank - b.rank);
  const out: Record<string, Primary> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const cands = (lang: 'ru' | 'kk') => {
    const m = new Map<string, string[]>();
    for (const it of (JSON.parse(readFileSync(join(ROOT, 'data', 'build', `titles.${lang}.json`), 'utf8')) as { items: { code: string; title: string }[] }).items) {
      if (!m.has(it.code)) m.set(it.code, []);
      m.get(it.code)!.push(it.title);
    }
    return m;
  };
  const ru = cands('ru');
  const kk = cands('kk');
  const todo = index.slice(0, top).filter((e) => !out[e.code]);
  let spent = 0;
  for (let i = 0; i < todo.length && spent < maxUsd; i += 30) {
    const batch = todo.slice(i, i + 30);
    const user = JSON.stringify(batch.map((e) => ({ code: e.code, title: e.title, ruCandidates: ru.get(e.code) ?? [], kkCandidates: kk.get(e.code) ?? [] })));
    const res = await callModel({ op: 'title.primary', schema, system: SYSTEM, user, locale: 'ru', cacheKey: user, maxTokens: 4000, temperature: 0 });
    spent += res.cached ? 0 : res.usage.costUsd;
    const asked = new Set(batch.map((e) => e.code));
    for (const it of res.data.items) {
      if (asked.has(it.code) && it.ru.trim() && it.kk.trim()) out[it.code] = { ru: it.ru.trim(), kk: it.kk.trim(), source: 'model' };
    }
    const sorted: Record<string, Primary> = {};
    for (const k of Object.keys(out).sort()) sorted[k] = out[k];
    writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`[titles-primary] ${Math.min(i + 30, todo.length)}/${todo.length}, $${spent.toFixed(4)}`);
  }
  console.log(`[titles-primary] done, $${spent.toFixed(4)}. Review data/titles-primary.json by hand and set source: "reviewed".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
