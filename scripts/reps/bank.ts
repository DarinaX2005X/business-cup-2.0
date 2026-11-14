import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../ai/load-env';

/**
 * Builds the pre-generated rep bank (03.3): data/rep-bank/<code>/<type>-<n>.json, the landing minis in
 * data/rep-bank/landing/ and data/rep-bank/REPORT.md.
 *
 *   npm run reps:bank -- --max-usd 1.5        build (resumable: finished, valid entries are skipped)
 *   npm run reps:bank -- --dry                print the plan and the cost estimate only
 *   options: --only=<code or title prefix>  --concurrency=3  --report (rewrite REPORT.md only)
 *
 * Entries come from the same generators and checks as the live path (src/server/reps).
 */

loadEnv();

const ROOT = process.cwd();
const BANK = path.join(ROOT, 'data', 'rep-bank');
const LEDGER = path.join(BANK, 'ledger.json');

const flag = (name: string) => process.argv.includes(`--${name}`);
function opt(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : process.argv[i + 1];
}

// Tasks that make a readable ten-second document; the first slip task is used when one is not in the week.
const PREFERRED_LANDING: Record<string, string> = { electrician: 'Circuit testing' };

interface LedgerRow {
  key: string;
  attempts: number;
  costUsd: number;
  rejected: string[][];
  at: string;
}
interface Failure {
  key: string;
  problems: string[];
  at: string;
}
interface Ledger {
  rows: Record<string, LedgerRow>;
  failures: Record<string, Failure>;
}

function readLedger(): Ledger {
  try {
    const l = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
    return { rows: l.rows ?? {}, failures: l.failures ?? {} };
  } catch {
    return { rows: {}, failures: {} };
  }
}
const writeLedger = (l: Ledger) => writeFileSync(LEDGER, JSON.stringify(l, null, 2));

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readValid(file: string, check: (v: unknown) => { ok: boolean }): boolean {
  if (!existsSync(file)) return false;
  try {
    return check(JSON.parse(readFileSync(file, 'utf8'))).ok;
  } catch {
    return false;
  }
}

async function main() {
  const maxUsd = Number(opt('max-usd') ?? 1.5);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--max-usd must be a positive number');
  const concurrency = Math.max(1, Math.min(6, Number(opt('concurrency') ?? 3)));
  const dry = flag('dry');

  const { buildPlan, loadBundle, candidates } = await import('./plan');
  const { checkBankEntry, generateSlip, generateDelegate, generateEdge, plannedTypes } = await import('@/server/reps');
  const { isAiError, getModelId } = await import('@/server/ai/client');
  const { getPrice } = await import('@/server/ai/pricing');
  const { writeReport } = await import('./report');

  mkdirSync(BANK, { recursive: true });
  const plan = buildPlan(ROOT);
  const landingAll = plan.landing.map((l) => {
    const bundle = loadBundle(ROOT, l.code);
    const list = candidates(bundle, 'slip');
    const task = list.find((t) => t.short === PREFERRED_LANDING[l.name]) ?? list[0];
    return { ...l, occupation: bundle.title, taskId: task.id, taskText: task.text, taskShort: task.short ?? '' };
  });
  const only = opt('only');
  const jobs = plan.jobs.filter((j) => !only || j.code === only || j.occupation.toLowerCase().startsWith(only.toLowerCase()));
  const landing = landingAll.filter((l) => !only || l.name === only || l.code === only);

  if (flag('report')) {
    writeReport(BANK, readLedger(), plan.jobs, landingAll);
    console.log('REPORT.md rewritten');
    return;
  }

  const todo = jobs.filter((j) => !readValid(path.join(BANK, `${j.key}.json`), checkBankEntry));
  const todoLanding = landing.filter((l) => !readValid(path.join(BANK, 'landing', `${l.name}.json`), checkBankEntry));

  // Estimate: tokens per call are rough figures for these prompts with minimal reasoning.
  const price = getPrice(getModelId());
  const perCall = (promptTok: number, outTok: number) => promptTok * price.prompt + outTok * price.completion;
  const unit = { slip: perCall(1700, 1700), delegate: perCall(1500, 1500), edge: perCall(1300, 1100), landing: perCall(1700, 600) };
  const retryFactor = 1.25;
  const count = (t: string) => todo.filter((j) => j.type === t).length;
  const estimate = (count('slip') * unit.slip + count('delegate') * unit.delegate + count('edge') * unit.edge + todoLanding.length * unit.landing) * retryFactor;
  console.log(`model ${getModelId()}`);
  console.log(
    `bank: ${jobs.length} entries planned (${jobs.filter((j) => j.type === 'slip').length} slips, ${jobs.filter((j) => j.type === 'delegate').length} delegates, ${jobs.filter((j) => j.type === 'edge').length} edges) + ${landing.length} landing minis`,
  );
  for (const n of plan.notes) console.log(`note: ${n}`);
  console.log(`to generate now: ${todo.length} entries + ${todoLanding.length} landing minis (the rest exist and pass the check)`);
  console.log(`estimated cost: $${estimate.toFixed(2)} (limit $${maxUsd.toFixed(2)})`);
  if (dry) {
    for (const j of todo) console.log(`  ${j.key.padEnd(24)} ${j.locale} d${j.difficulty}  ${j.occupation.slice(0, 34).padEnd(34)} ${j.taskShort}`);
    for (const l of todoLanding) console.log(`  landing/${l.name.padEnd(16)} en d1  ${l.occupation.slice(0, 34).padEnd(34)} ${l.taskShort}`);
    return;
  }
  if (estimate > maxUsd) console.log('warning: the estimate is above the limit; generation stops at the limit and a rerun continues.');

  const ledger = readLedger();
  let spent = 0;
  let stop: string | null = null;
  const stats = { done: 0, failed: 0 };
  let avgSlip = unit.slip;

  const record = (key: string, r: { attempts: number; costUsd: number; rejected: string[][] }) => {
    spent += r.costUsd;
    ledger.rows[key] = { key, attempts: r.attempts, costUsd: r.costUsd, rejected: r.rejected, at: new Date().toISOString() };
    delete ledger.failures[key];
    writeLedger(ledger);
  };
  const fail = (key: string, err: unknown) => {
    const problems = isAiError(err) ? [`${err.code}: ${err.message}`] : [(err as Error).message];
    // a failed entry used its attempts without returning a cost; count them at the average
    spent += avgSlip * 3;
    ledger.failures[key] = { key, problems, at: new Date().toISOString() };
    writeLedger(ledger);
    stats.failed++;
    console.log(`  FAILED ${key}: ${problems[0].slice(0, 160)}`);
    if (isAiError(err) && (err.code === 'budget_exceeded' || err.code === 'rate_limited')) stop = `stopped: ${err.code}`;
  };

  type Work = { key: string; run: () => Promise<{ attempts: number; costUsd: number; rejected: string[][] }> };
  const work: Work[] = [];

  for (const j of todo) {
    work.push({
      key: j.key,
      run: async () => {
        const input = {
          occupationCode: j.code,
          occupation: j.occupation,
          taskId: j.taskId,
          task: j.task,
          taskShort: j.taskShort,
          locale: j.locale,
          difficulty: j.difficulty,
          seed: j.seed,
        };
        const gen = j.type === 'slip' ? await generateSlip(input) : j.type === 'delegate' ? await generateDelegate(input) : await generateEdge(input);
        const checked = checkBankEntry(gen.entry);
        if (!checked.ok) throw new Error(`generated entry fails checkBankEntry: ${checked.problem}`);
        writeJson(path.join(BANK, `${j.key}.json`), gen.entry);
        if (j.type === 'slip') avgSlip = (avgSlip + gen.costUsd) / 2;
        return gen;
      },
    });
  }
  if (todoLanding.length) {
    const { generateLanding } = await import('./landing');
    for (const l of todoLanding) {
      work.push({
        key: `landing/${l.name}`,
        run: async () => {
          const gen = await generateLanding({
            occupationCode: l.code,
            occupation: l.occupation,
            taskId: l.taskId,
            task: l.taskText,
            taskShort: l.taskShort,
            types: plannedTypes(l.code, 1, 0),
            seed: `bank:landing:${l.name}`,
          });
          const checked = checkBankEntry(gen.entry);
          if (!checked.ok) throw new Error(`landing entry fails checkBankEntry: ${checked.problem}`);
          writeJson(path.join(BANK, 'landing', `${l.name}.json`), gen.entry);
          return gen;
        },
      });
    }
  }

  let next = 0;
  const startedAt = Date.now();
  async function worker() {
    while (!stop) {
      if (spent >= maxUsd) {
        stop = `stopped: spend $${spent.toFixed(3)} reached the limit $${maxUsd.toFixed(2)}`;
        break;
      }
      const w = work[next++];
      if (!w) break;
      try {
        const r = await w.run();
        record(w.key, r);
        stats.done++;
        console.log(`  ok ${w.key.padEnd(24)} attempts ${r.attempts}  $${r.costUsd.toFixed(4)}  (spent $${spent.toFixed(3)}, ${stats.done}/${work.length})`);
      } catch (err) {
        fail(w.key, err);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  writeReport(BANK, ledger, plan.jobs, landingAll);
  const left = work.length - stats.done - stats.failed;
  console.log(`\n${stop ?? 'finished'}; generated ${stats.done}, failed ${stats.failed}, not started ${Math.max(0, left)}; spent about $${spent.toFixed(3)} in ${Math.round((Date.now() - startedAt) / 1000)} s`);
  if (stats.failed || left > 0) console.log('rerun the same command to continue: finished entries are skipped');
  process.exitCode = stats.failed || left > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
