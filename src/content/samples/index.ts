import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Fictional sample résumés for "Try with a sample résumé" (no real people or organisations).
 * The .txt files are the source; the server reads them (GET /api/xray/sample?name=).
 */

export const SAMPLE_NAMES = ['nurse', 'electrician', 'software', 'accountant'] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

export const isSampleName = (v: unknown): v is SampleName => typeof v === 'string' && (SAMPLE_NAMES as readonly string[]).includes(v);

const DIR = path.join(process.cwd(), 'src', 'content', 'samples');
const cache = new Map<SampleName, Promise<string>>();

/** True for the exact text of one of the fictional samples (whitespace aside): only those may be cached. */
export async function isSampleText(text: string): Promise<boolean> {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const t = norm(text);
  const all = await Promise.all(SAMPLE_NAMES.map((n) => readSample(n).catch(() => '')));
  return all.some((s) => s && norm(s) === t);
}

export function readSample(name: SampleName): Promise<string> {
  let p = cache.get(name);
  if (!p) {
    p = readFile(path.join(DIR, `resume-${name}.txt`), 'utf8');
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}
