import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Fictional sample résumés for "Try with a sample résumé" (no real people or organisations).
 * The .txt files are the source; the server reads them (GET /api/xray/sample?name=).
 */

export const SAMPLE_NAMES = ['nurse', 'electrician'] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

export const isSampleName = (v: unknown): v is SampleName => typeof v === 'string' && (SAMPLE_NAMES as readonly string[]).includes(v);

const DIR = path.join(process.cwd(), 'src', 'content', 'samples');
const cache = new Map<SampleName, Promise<string>>();

export function readSample(name: SampleName): Promise<string> {
  let p = cache.get(name);
  if (!p) {
    p = readFile(path.join(DIR, `resume-${name}.txt`), 'utf8');
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}
