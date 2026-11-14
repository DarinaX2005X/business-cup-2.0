import data from './technology.json';

/**
 * Technologies O*NET lists for an occupation (built by technology.build.ts from «Software Skills»):
 * `inDemand` = often named in this occupation's own job postings, `hot` = often named in postings overall.
 */

export interface Technology {
  name: string;
  hot: boolean;
  inDemand: boolean;
}

const OCC = (data as unknown as { occ: Record<string, [string, number][]> }).occ;

export function technologiesFor(code: string): Technology[] {
  return (OCC[code] ?? []).map(([name, flags]) => ({ name, hot: (flags & 1) === 1, inDemand: (flags & 2) === 2 }));
}

/** Words that never decide a match on their own. */
const FILLER = new Set(['software', 'the', 'and', 'of', 'for', 'microsoft', 'apache', 'google', 'amazon', 'ibm', 'oracle', 'adobe', 'systems', 'system', 'services', 'web']);

export function techWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[#+]/g, (c) => (c === '#' ? 'sharp' : 'plus'))
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/**
 * The O*NET technology a tool the person named stands for, or null. «Excel» → «Microsoft Excel»,
 * «AWS» → «Amazon Web Services AWS software», «Epic» → «Epic Systems», «C#» stays apart from «C».
 * Every meaningful word of the shorter name must appear in the longer one.
 */
export function matchTechnology(tool: string, list: readonly Technology[]): Technology | null {
  const words = techWords(tool);
  if (!words.length) return null;
  const key = words.join(' ');
  let best: { tech: Technology; score: number } | null = null;
  for (const tech of list) {
    const tw = techWords(tech.name);
    if (tw.join(' ') === key) return tech;
    const core = words.filter((w) => !FILLER.has(w));
    const techCore = tw.filter((w) => !FILLER.has(w));
    if (!core.length || !techCore.length) continue;
    const toolInTech = core.every((w) => tw.includes(w));
    const techInTool = techCore.every((w) => words.includes(w));
    if (!toolInTech && !techInTool) continue;
    // Prefer the closest name: fewest extra words.
    const score = 10 - Math.abs(tw.length - words.length) + (tech.inDemand ? 1 : 0);
    if (!best || score > best.score) best = { tech, score };
  }
  return best?.tech ?? null;
}
