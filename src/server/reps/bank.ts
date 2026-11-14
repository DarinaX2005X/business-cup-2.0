import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { hash32, slipRangesValid, type RepNote } from '@/domain/reps';
import type { Locale, RepType } from '@/domain/types';

/**
 * The pre-generated rep bank (03.3): data/rep-bank/<code>/<type>-<n>.json, each file one BankEntry
 * produced by the same generators and checks as the live path. Read once per instance; a missing
 * directory is an empty bank, a malformed or failing file is skipped with a log line.
 * REP_BANK_DIR overrides the location (tests).
 */

const slipErrorSchema = z.object({
  quote: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  type: z.enum(['fact', 'logic', 'compliance', 'omission', 'tone', 'calculation']),
  explanation: z.string().min(1),
  fix: z.string().min(1),
});
const rubricSchema = z.object({ id: z.string().min(1), text: z.string().min(1), keywords: z.array(z.string()) });
const trapSchema = z.object({ id: z.string().min(1), description: z.string().min(1), keywords: z.array(z.string()).min(1) });

const base = {
  occupationCode: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/),
  taskId: z.string().min(1),
  locale: z.enum(['en', 'ru', 'kk']),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  brief: z.string(),
};

export const bankSlipSchema = z.object({
  type: z.literal('slip'),
  ...base,
  docType: z.string().min(1),
  slip: z.object({ document: z.string().min(1), errors: z.array(slipErrorSchema).min(1).max(6) }),
});
export const bankDelegateSchema = z.object({
  type: z.literal('delegate'),
  ...base,
  delegate: z.object({
    scenario: z.string().min(1),
    inputs: z.string().min(1),
    goal: z.string().min(1),
    criteria: z.array(rubricSchema).min(3).max(6),
    traps: z.array(trapSchema).min(1).max(3),
  }),
});
export const bankEdgeSchema = z.object({
  type: z.literal('edge'),
  ...base,
  edge: z.object({
    scenario: z.string().min(1),
    personaPublic: z.string().min(1),
    personaHidden: z.string().min(1),
    goal: z.string().min(1),
    criteria: z.array(rubricSchema).min(3).max(6),
    opening: z.string().min(1),
  }),
});
export const bankEntrySchema = z.discriminatedUnion('type', [bankSlipSchema, bankDelegateSchema, bankEdgeSchema]);

export type BankSlip = z.infer<typeof bankSlipSchema>;
export type BankDelegate = z.infer<typeof bankDelegateSchema>;
export type BankEdge = z.infer<typeof bankEdgeSchema>;
export type BankEntry = z.infer<typeof bankEntrySchema>;
export type BankEntryOf<T extends RepType> = Extract<BankEntry, { type: T }>;

/** A bank entry with the file it came from (stable reference stored in rep.seed). */
export type BankItem<T extends RepType = RepType> = BankEntryOf<T> & { file: string };

export function bankRoot(): string {
  return process.env.REP_BANK_DIR || path.join(process.cwd(), 'data', 'rep-bank');
}

const FILE_RE = /^(slip|delegate|edge)-(\d+)\.json$/;
const CODE_RE = /^\d{2}-\d{4}\.\d{2}$/;

/** Checks a parsed entry beyond the schema: slip ranges must hold their quotes. */
export function checkBankEntry(value: unknown): { ok: true; entry: BankEntry } | { ok: false; problem: string } {
  const parsed = bankEntrySchema.safeParse(value);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const entry = parsed.data;
  if (entry.type === 'slip' && !slipRangesValid(entry.slip)) return { ok: false, problem: 'slip ranges do not match their quotes' };
  return { ok: true, entry };
}

const dirCache = new Map<string, Promise<BankItem[]>>();

async function readCodeDir(root: string, code: string): Promise<BankItem[]> {
  let files: string[];
  try {
    files = await readdir(path.join(root, code));
  } catch {
    return [];
  }
  const items: BankItem[] = [];
  for (const file of files.filter((f) => FILE_RE.test(f)).sort((a, b) => fileOrder(a) - fileOrder(b))) {
    try {
      const raw = JSON.parse(await readFile(path.join(root, code, file), 'utf8'));
      const checked = checkBankEntry(raw);
      if (!checked.ok) {
        console.warn(`[reps] bank ${code}/${file} skipped: ${checked.problem}`);
        continue;
      }
      if (checked.entry.occupationCode !== code || !file.startsWith(`${checked.entry.type}-`)) {
        console.warn(`[reps] bank ${code}/${file} skipped: code or type does not match its path`);
        continue;
      }
      items.push({ ...checked.entry, file: `${code}/${file}` } as BankItem);
    } catch (err) {
      console.warn(`[reps] bank ${code}/${file} unreadable: ${(err as Error).message}`);
    }
  }
  return items;
}

function fileOrder(f: string): number {
  return Number(FILE_RE.exec(f)?.[2] ?? 0);
}

async function codeItems(code: string): Promise<BankItem[]> {
  const root = bankRoot();
  const key = `${root}|${code}`;
  let p = dirCache.get(key);
  if (!p) {
    p = readCodeDir(root, code);
    dirCache.set(key, p);
  }
  return p;
}

let codesCache: { root: string; codes: Promise<string[]> } | null = null;

/** Occupation codes present in the bank. */
export async function listBankCodes(): Promise<string[]> {
  const root = bankRoot();
  if (!codesCache || codesCache.root !== root) {
    codesCache = {
      root,
      codes: readdir(root, { withFileTypes: true })
        .then((d) => d.filter((e) => e.isDirectory() && CODE_RE.test(e.name)).map((e) => e.name).sort())
        .catch(() => []),
    };
  }
  return codesCache.codes;
}

/** Tests only: forget cached directory listings. */
export function resetBankCache(): void {
  dirCache.clear();
  codesCache = null;
}

/**
 * Bank entries of one occupation, type and language, in file order. Empty when the bank or the
 * occupation directory does not exist.
 */
export async function readBank<T extends RepType>(code: string, type: T, locale: Locale): Promise<BankItem<T>[]> {
  if (!CODE_RE.test(code)) return [];
  const items = await codeItems(code);
  return items.filter((i): i is BankItem<T> => i.type === type && i.locale === locale);
}

export interface BankPick<T extends RepType> {
  item: BankItem<T>;
  notes: RepNote[];
}

export interface BankQuery {
  code: string;
  locale: Locale;
  /** Tasks of the person's week, preferred within the same occupation. */
  weekTaskIds?: readonly string[];
  /** Tasks to avoid (done in the last days), used only while others exist. */
  avoidTaskIds?: readonly string[];
  seed: string;
}

function choose<T extends RepType>(items: BankItem<T>[], q: BankQuery, sameCode: boolean): BankItem<T> | null {
  if (!items.length) return null;
  const avoid = new Set(q.avoidTaskIds ?? []);
  const fresh = items.filter((i) => !avoid.has(i.taskId));
  let pool = fresh.length ? fresh : items;
  if (sameCode && q.weekTaskIds?.length) {
    const week = new Set(q.weekTaskIds);
    const inWeek = pool.filter((i) => week.has(i.taskId));
    if (inWeek.length) pool = inWeek;
    else return pool[0]; // "otherwise the first one for the occupation"
  }
  return pool[hash32(q.seed) % pool.length];
}

/**
 * One rep of `type` from the same occupation: the user's language first, then English with the
 * `english_only` note.
 */
export async function findBankSame<T extends RepType>(type: T, q: BankQuery, opts: { english?: boolean } = {}): Promise<BankPick<T> | null> {
  const own = choose(await readBank(q.code, type, q.locale), q, true);
  if (own) return { item: own, notes: [] };
  if (q.locale !== 'en' && opts.english !== false) {
    const en = choose(await readBank(q.code, type, 'en'), q, true);
    if (en) return { item: en, notes: ['english_only'] };
  }
  return null;
}

/**
 * Fallback slip: same occupation → same SOC major group → any occupation ("related_job"), each level
 * in the user's language first, then English ("english_only").
 */
export async function findBankSlip(q: BankQuery): Promise<BankPick<'slip'> | null> {
  const same = await findBankSame('slip', q);
  if (same) return same;
  const codes = (await listBankCodes()).filter((c) => c !== q.code);
  const major = q.code.slice(0, 2);
  const levels = [codes.filter((c) => c.startsWith(major)), codes.filter((c) => !c.startsWith(major))];
  for (const level of levels) {
    for (const locale of q.locale === 'en' ? (['en'] as const) : ([q.locale, 'en'] as const)) {
      const all = (await Promise.all(level.map((c) => readBank(c, 'slip', locale)))).flat();
      const pick = choose(all, q, false);
      if (pick) return { item: pick, notes: locale !== q.locale ? ['related_job', 'english_only'] : ['related_job'] };
    }
  }
  return null;
}
