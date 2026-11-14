import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Job } from './plan';

/** data/rep-bank/REPORT.md: one row per stored entry, then the rejected attempts and failures. */

interface Row {
  key: string;
  attempts: number;
  costUsd: number;
  rejected: string[][];
}
export interface Led {
  rows: Record<string, Row>;
  failures: Record<string, { key: string; problems: string[] }>;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describe(entry: Record<string, any>): { items: string; length: string; title: string } {
  if (entry.type === 'slip') return { items: `${entry.slip.errors.length} errors`, length: `${words(entry.slip.document)} words`, title: entry.title };
  if (entry.type === 'delegate') return { items: `${entry.delegate.traps.length} traps, ${entry.delegate.criteria.length} criteria`, length: `${words(entry.delegate.inputs)} words`, title: entry.title };
  return { items: `${entry.edge.criteria.length} criteria`, length: `${words(entry.edge.scenario) + words(entry.edge.opening)} words`, title: entry.title };
}

export function writeReport(bank: string, ledger: Led, jobs: Job[], landing: { name: string; code: string; occupation?: string; taskShort?: string }[]): void {
  const rejectedLines: string[] = [];
  let total = 0;
  let count = 0;
  let missing = 0;
  const rows: string[] = [];

  const add = (key: string, file: string, occupation: string, task: string, locale: string) => {
    if (!existsSync(file)) {
      missing++;
      return;
    }
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const d = describe(entry);
    const led = ledger.rows[key];
    count++;
    total += led?.costUsd ?? 0;
    rows.push(`| ${cell(occupation)} | ${cell(task)} | ${entry.type} | ${locale} | ${d.items} | ${led ? led.attempts : '-'} | ${d.length} | ${led ? `$${led.costUsd.toFixed(4)}` : '-'} | ${cell(d.title)} |`);
    for (const [i, problems] of (led?.rejected ?? []).entries()) rejectedLines.push(`- ${key}, attempt ${i + 1}: ${cell(problems.join(' / ')).slice(0, 300)}`);
  };

  for (const j of jobs) add(j.key, path.join(bank, `${j.key}.json`), j.occupation, j.taskShort, j.locale);
  for (const l of landing) add(`landing/${l.name}`, path.join(bank, 'landing', `${l.name}.json`), `Landing mini: ${l.occupation ?? l.name}`, l.taskShort ?? '', 'en');

  const lines = [
    '# Rep bank report',
    '',
    `${count} entries stored, ${missing} planned but missing. Recorded cost of this bank: $${total.toFixed(3)} (entries without a ledger row show "-").`,
    '',
    '| Occupation | Task | Type | Lang | Items | Attempts | Length | Cost | Title |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Rejected attempts',
    '',
    rejectedLines.length ? rejectedLines.join('\n') : 'None: every entry passed the check on its first attempt.',
    '',
  ];
  const fails = Object.values(ledger.failures);
  lines.push('## Entries that failed and are not in the bank', '', fails.length ? fails.map((f) => `- ${f.key}: ${cell(f.problems.join(' / ')).slice(0, 300)}`).join('\n') : 'None.', '');
  writeFileSync(path.join(bank, 'REPORT.md'), lines.join('\n'));
}
