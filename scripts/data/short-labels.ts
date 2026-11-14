// npm run data:short-labels [-- --max-usd=0.8] [-- --top=150] [-- --batch=2] [-- --concurrency=1]
// Plain-English 2–4 word labels for the tasks of the most employed occupations ("Charting", "Bedside
// assessment", "Wiring installation"), written by the model through src/server/ai/client.ts (budget, cache,
// strict schema). Output: data/build/short-labels.en.json { taskId: label }. Run `npm run data:build` afterwards:
// the build puts them into OccTask.short; other tasks keep the deterministic shortLabel(text) fallback.
// Labels already in the file are kept, so an interrupted run continues where it stopped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { OccupationBundle, OccupationIndexEntry } from '../../src/domain/types';
import { loadEnv } from '../ai/load-env';

loadEnv();

const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'data', 'build', 'short-labels.en.json');
const arg = (name: string, fallback: number) => {
  const v = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};

const schema = z.object({ labels: z.array(z.object({ id: z.string(), label: z.string() })) });

const SYSTEM = [
  'You write very short labels for job tasks, shown inside a narrow bar chart of a work week.',
  'For each task return a 2–4 word label in plain everyday English that a person in that job would recognise,',
  'like "Charting", "Bedside assessment", "Medication rounds", "Wiring installation", "Invoice processing".',
  'Prefer a noun phrase; no trailing punctuation, no quotes, no abbreviations the reader may not know.',
  'Labels inside one occupation must be distinct. Return every input id exactly once.',
].join(' ');

/** 1–4 words, at most 32 characters, letters first, no trailing punctuation. */
export function validLabel(label: string): string | null {
  const t = label.trim().replace(/[.;:,!]+$/, '');
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4 || t.length > 32 || !/^\p{L}/u.test(t)) return null;
  return t;
}

async function main() {
  const maxUsd = arg('max-usd', 0.8);
  const top = arg('top', 150);
  const batch = arg('batch', 2);
  const concurrency = arg('concurrency', 1);
  const { callModel, getModelId, isAiError } = await import('@/server/ai/client');
  const index = JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'index.json'), 'utf8')) as OccupationIndexEntry[];
  const labels: Record<string, string> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const occs = [...index]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, top)
    .map((e) => JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'occ', `${e.code}.json`), 'utf8')) as OccupationBundle)
    .filter((b) => b.tasks.some((t) => !labels[t.id]));
  console.log(`[short-labels] model ${getModelId()}, ${occs.length} of top ${top} occupations to label, budget $${maxUsd}`);

  const save = () => {
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(labels).sort((a, b) => Number(a) - Number(b))) sorted[k] = labels[k];
    writeFileSync(OUT, JSON.stringify(sorted, null, 1));
  };
  let spent = 0;
  let calls = 0;
  const groups: OccupationBundle[][] = [];
  for (let i = 0; i < occs.length; i += batch) groups.push(occs.slice(i, i + batch));
  let next = 0;
  let done = 0;
  let stop = false;
  // A few workers share the queue; every finished batch is saved, so an interrupted run resumes.
  const worker = async () => {
    while (!stop && next < groups.length) {
      if (spent >= maxUsd) {
        console.warn(`[short-labels] stopped: spent $${spent.toFixed(4)} of $${maxUsd}; run again to continue`);
        stop = true;
        break;
      }
      const group = groups[next++];
      const user = JSON.stringify(group.map((b) => ({ occupation: b.title, tasks: b.tasks.map((t) => ({ id: t.id, text: t.text })) })));
      try {
        const res = await callModel({ op: 'task.short', schema, system: SYSTEM, user, locale: 'en', cacheKey: user, maxTokens: 6000, temperature: 0.2 });
        calls++;
        spent += res.cached ? 0 : res.usage.costUsd;
        const asked = new Set(group.flatMap((b) => b.tasks.map((t) => t.id)));
        let ok = 0;
        for (const { id, label } of res.data.labels) {
          const v = validLabel(label);
          if (asked.has(id) && v) {
            labels[id] = v;
            ok++;
          }
        }
        save();
        done += group.length;
        console.log(`[short-labels] ${done}/${occs.length}: ${ok}/${asked.size} labels, $${spent.toFixed(4)}${res.cached ? ' (cached)' : ''}`);
      } catch (err) {
        if (isAiError(err)) {
          console.error(`[short-labels] stopped on ${err.code}: ${err.message}. Partial results are saved.`);
          process.exitCode = 1;
          stop = true;
          break;
        }
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[short-labels] ${Object.keys(labels).length} labels in file, ${calls} calls, $${spent.toFixed(4)}. Run \`npm run data:build\` next.`);
}

if (process.argv[1] && /short-labels\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
