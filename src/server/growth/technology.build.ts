/**
 * Builds src/server/growth/technology.json from O*NET 31.0 «Software Skills.txt»:
 * per occupation, the technologies O*NET marks as In Demand (often named in this occupation's job
 * postings) or Hot (often named in job postings overall), at most MAX_PER_OCC, in-demand first.
 *
 *   npx tsx src/server/growth/technology.build.ts
 *
 * Never imported by the app (the app imports the JSON it writes). See REQUESTS «R3 growth» about
 * moving this into scripts/data next to the other data builders.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data', 'raw', 'onet_31_0_text', 'db_31_0_text', 'Software Skills.txt');
const OUT = path.join(ROOT, 'src', 'server', 'growth', 'technology.json');
const MAX_PER_OCC = 40;

/** Bit flags: 1 = Hot Technology, 2 = In Demand for this occupation. */
type Row = [name: string, flags: number];

function main() {
  const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
  const header = lines[0].split('\t');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`column "${name}" not found in ${SRC}`);
    return i;
  };
  const cCode = col('O*NET-SOC Code');
  const cName = col('Workplace Example');
  const cHot = col('Hot Technology');
  const cDemand = col('In Demand');

  const byOcc = new Map<string, Map<string, number>>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    const flags = (f[cHot] === 'Y' ? 1 : 0) | (f[cDemand] === 'Y' ? 2 : 0);
    if (!flags) continue;
    const code = f[cCode];
    const name = f[cName].trim();
    if (!code || !name) continue;
    const m = byOcc.get(code) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) | flags);
    byOcc.set(code, m);
  }

  const occ: Record<string, Row[]> = {};
  for (const code of [...byOcc.keys()].sort()) {
    const rows = [...byOcc.get(code)!.entries()]
      .sort((a, b) => (b[1] & 2) - (a[1] & 2) || a[0].localeCompare(b[0]))
      .slice(0, MAX_PER_OCC);
    occ[code] = rows;
  }
  const out = { source: 'O*NET 31.0 Software Skills', flags: { hot: 1, inDemand: 2 }, occ };
  writeFileSync(OUT, JSON.stringify(out));
  const total = Object.values(occ).reduce((n, r) => n + r.length, 0);
  console.log(`technology.json: ${Object.keys(occ).length} occupations, ${total} rows`);
}

main();
