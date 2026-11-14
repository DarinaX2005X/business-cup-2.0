import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../ai/load-env';

/**
 * Independent review of every stored bank entry (03.3) with verifyEntry (rep.verify):
 *
 *   npx tsx scripts/reps/verify.ts --max-usd 0.3      verify what is not yet verified (resumable)
 *   npx tsx scripts/reps/verify.ts --drop             delete the rejected entries (landing minis excepted),
 *                                                     so `npm run reps:bank` regenerates them
 *   npx tsx scripts/reps/verify.ts --report           only rewrite the log section of REPORT.md
 *
 * The result of each file is kept in data/rep-bank/verify.json with the file's hash, so an entry that
 * was regenerated is checked again and a finished one is not paid for twice.
 */

loadEnv();

const ROOT = process.cwd();
const BANK = path.join(ROOT, 'data', 'rep-bank');
const LOG = path.join(BANK, 'verify.json');

interface Row {
  key: string;
  hash: string;
  ok: boolean;
  problems: string[];
  costUsd: number;
  at: string;
}
type Log = Record<string, Row>;

const flag = (n: string) => process.argv.includes(`--${n}`);
function opt(n: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : process.argv[i + 1];
}

const readLog = (): Log => {
  try {
    return JSON.parse(readFileSync(LOG, 'utf8')) as Log;
  } catch {
    return {};
  }
};
const writeLog = (l: Log) => writeFileSync(LOG, JSON.stringify(l, null, 2));
const sha = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 12);

function allKeys(): string[] {
  const keys: string[] = [];
  for (const d of readdirSync(BANK, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const f of readdirSync(path.join(BANK, d.name)).filter((x) => x.endsWith('.json'))) keys.push(`${d.name}/${f.replace(/\.json$/, '')}`);
  }
  return keys.sort();
}

const BEGIN = '<!-- verification-log:begin -->';
const END = '<!-- verification-log:end -->';

function writeReportSection(log: Log, keys: string[], showcase: string[]) {
  const rows = keys.map((k) => log[k]).filter(Boolean);
  const rejected = rows.filter((r) => !r.ok);
  const reasons = new Map<string, number>();
  for (const r of rejected) for (const p of r.problems) {
    const m = /(unplanned|not (a )?(real|mistake|error)|ambigu|allowed|evidence|not verbatim|contradict|trap|calculation|arithmetic)/i.exec(p);
    const k = m ? m[1].toLowerCase() : 'other';
    reasons.set(k, (reasons.get(k) ?? 0) + 1);
  }
  const lines = [
    BEGIN,
    '## Verification log (rep.verify)',
    '',
    `${rows.length} of ${keys.length} entries verified; ${rows.filter((r) => r.ok).length} accepted, ${rejected.length} rejected and not yet replaced. Verifier cost: $${rows.reduce((a, r) => a + r.costUsd, 0).toFixed(3)}. Showcase entries: ${showcase.join(', ')}.`,
    '',
    '| Entry | Result | Reason (first problems) |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.key}${showcase.includes(`${r.key}.json`) ? ' (showcase)' : ''} | ${r.ok ? 'ok' : 'rejected'} | ${r.ok ? '' : r.problems.slice(0, 2).join(' / ').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 260)} |`),
    END,
  ];
  const file = path.join(BANK, 'REPORT.md');
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '# Rep bank report\n';
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a >= 0 && b > a) text = text.slice(0, a) + lines.join('\n') + text.slice(b + END.length);
  else text = `${text.trimEnd()}\n\n${lines.join('\n')}\n`;
  writeFileSync(file, text);
}

async function main() {
  const maxUsd = Number(opt('max-usd') ?? 0.3);
  const concurrency = Math.max(1, Math.min(6, Number(opt('concurrency') ?? 4)));
  const keys = allKeys();
  const log = readLog();
  const showcase: string[] = existsSync(path.join(BANK, 'showcase.json')) ? JSON.parse(readFileSync(path.join(BANK, 'showcase.json'), 'utf8')) : [];

  if (flag('report')) {
    writeReportSection(log, keys, showcase);
    return;
  }
  if (flag('drop')) {
    let n = 0;
    for (const k of keys) {
      const r = log[k];
      if (!r || r.ok || k.startsWith('landing/')) continue;
      if (r.hash !== sha(readFileSync(path.join(BANK, `${k}.json`), 'utf8'))) continue; // changed since the verdict
      rmSync(path.join(BANK, `${k}.json`));
      n++;
    }
    console.log(`deleted ${n} rejected entries; run npm run reps:bank to regenerate them`);
    return;
  }

  const { checkBankEntry } = await import('@/server/reps');
  const { verifyEntry } = await import('@/server/reps/generate'); // not re-exported from the index yet
  const { loadBundle } = await import('./plan');
  const titles = new Map<string, string>();
  const titleOf = (code: string) => {
    if (!titles.has(code)) titles.set(code, loadBundle(ROOT, code).title);
    return titles.get(code)!;
  };

  const todo = keys.filter((k) => {
    const hash = sha(readFileSync(path.join(BANK, `${k}.json`), 'utf8'));
    return !log[k] || log[k].hash !== hash;
  });
  console.log(`${keys.length} entries, ${todo.length} to verify; verifier spend limit $${maxUsd.toFixed(2)}`);

  let spent = 0;
  let next = 0;
  let stop: string | null = null;
  async function worker() {
    while (!stop) {
      if (spent >= maxUsd) {
        stop = `stopped at the limit $${maxUsd.toFixed(2)}`;
        break;
      }
      const k = todo[next++];
      if (!k) break;
      const text = readFileSync(path.join(BANK, `${k}.json`), 'utf8');
      try {
        const checked = checkBankEntry(JSON.parse(text));
        if (!checked.ok) throw new Error(`fails checkBankEntry: ${checked.problem}`);
        const v = await verifyEntry(checked.entry, { occupation: titleOf(checked.entry.occupationCode) });
        spent += v.costUsd;
        log[k] = { key: k, hash: sha(text), ok: v.ok, problems: v.problems, costUsd: v.costUsd, at: new Date().toISOString() };
        console.log(`  ${v.ok ? 'ok      ' : 'REJECTED'} ${k.padEnd(28)} $${v.costUsd.toFixed(4)} ${v.ok ? '' : v.problems[0]?.slice(0, 140)}`);
      } catch (err) {
        console.log(`  ERROR    ${k}: ${(err as Error).message.slice(0, 160)}`);
        const code = (err as { code?: string }).code;
        if (code === 'budget_exceeded' || code === 'rate_limited') stop = `stopped: ${code}`;
      }
      writeLog(log);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeReportSection(log, keys, showcase);
  const rejected = keys.filter((k) => log[k] && !log[k].ok);
  console.log(`${stop ?? 'finished'}; verified now ${next > todo.length ? todo.length : next} of ${todo.length}; spent $${spent.toFixed(3)}; rejected in total ${rejected.length}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
