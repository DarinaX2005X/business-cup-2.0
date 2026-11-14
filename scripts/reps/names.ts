import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Replaces the overused invented names in the stored bank (03.3) with names from the prompt's pool,
 * deterministically per entry (no model call): `npx tsx scripts/reps/names.ts [--dry]`.
 *
 * One mapping per entry is applied to every string of the file (document, quote, fix, explanation,
 * title, brief, delegate and edge texts, keywords), so a quote stays a substring of its document;
 * slip ranges are then recomputed and the entry is re-checked with checkBankEntry. Idempotent.
 */

const ROOT = path.join(process.cwd(), 'data', 'rep-bank');
const SURNAMES = ['Vance', 'Rostova', 'Jenkins', 'Pendelton'];
const FIRSTS = ['Marcus', 'Elena', 'Sarah'];
// "<First> <Surname>" where the surname is one of the overused ones
const FULL = new RegExp(`\\b([A-Z][a-z]+) (${SURNAMES.join('|')})\\b`, 'g');

function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  return value;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const { FIRST_NAMES, LAST_NAMES, COMPANY_STEMS } = await import('@/server/ai/prompts/rep-slip');
  const { hash32 } = await import('@/domain/reps');
  const { checkBankEntry } = await import('@/server/reps');

  let changed = 0;
  let problems = 0;
  for (const dir of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(path.join(ROOT, dir.name)).filter((f) => f.endsWith('.json') && f !== 'ledger.json')) {
      const key = `${dir.name}/${file}`;
      const full = path.join(ROOT, dir.name, file);
      const text = readFileSync(full, 'utf8');
      const hasApex = /\bApex(?=\b|[A-Z])/.test(text);
      const people = [...text.matchAll(FULL)].map((m) => ({ first: m[1], last: m[2] }));
      for (const f of FIRSTS) if (new RegExp(`\\b${f}\\b`).test(text)) people.push({ first: f, last: '' });
      for (const l of SURNAMES) if (new RegExp(`\\b${l}\\b`).test(text)) people.push({ first: '', last: l });
      if (!people.length && !hasApex) continue;

      const entry = JSON.parse(text);
      const used = new Set<string>();
      const pick = (pool: readonly string[], salt: string) => {
        let i = hash32(`${key}|${salt}`) % pool.length;
        while (used.has(pool[i])) i = (i + 1) % pool.length;
        used.add(pool[i]);
        return pool[i];
      };
      const firstMap = new Map<string, string>();
      const lastMap = new Map<string, string>();
      for (const p of people) {
        if (p.first && !firstMap.has(p.first)) firstMap.set(p.first, pick(FIRST_NAMES, `first:${p.first}`));
        if (p.last && !lastMap.has(p.last)) lastMap.set(p.last, pick(LAST_NAMES, `last:${p.last}`));
      }
      const company = pick(COMPANY_STEMS, 'company');
      const rewrite = (s: string) => {
        let out = s;
        for (const [a, b] of firstMap) out = out.replace(new RegExp(`\\b${a}\\b`, 'g'), b);
        for (const [a, b] of lastMap) out = out.replace(new RegExp(`\\b${a}\\b`, 'g'), b);
        return out.replace(/\bApex(?=\b|[A-Z])/g, company);
      };
      const next = mapStrings(entry, rewrite);
      if (next.slip) {
        const doc: string = next.slip.document;
        for (const e of next.slip.errors) {
          const at = doc.indexOf(e.quote);
          if (at < 0 || doc.indexOf(e.quote, at + 1) >= 0) {
            console.log(`PROBLEM ${key}: quote not unique after rewrite: ${e.quote}`);
            problems++;
          }
          e.start = at;
          e.end = at + e.quote.length;
        }
      }
      const checked = checkBankEntry(next);
      if (!checked.ok) {
        console.log(`PROBLEM ${key}: ${checked.problem}`);
        problems++;
        continue;
      }
      changed++;
      if (!dry) writeFileSync(full, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
  console.log(`${dry ? 'would rewrite' : 'rewrote'} ${changed} entries; ${problems} problems`);
  if (problems) process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
