import { describe, expect, it } from 'vitest';
import { chooseTask } from '@/domain/reps';
import type { RepType } from '@/domain/types';
import { generateDelegate, generateEdge, type GenerateInput } from '@/server/reps';
import { heuristicShort, loadBundle, typicalWeek } from '@/server/xray';
import { budgetLeft, loadLiveEnv, saveOutput, spend } from './live-helpers';

loadLiveEnv();

/**
 * Reliability of Delegate and Edge generation (round 3: no bank behind them). LIVE_RUNS generations per
 * type, cycling nurse → software → accountant with a different task and seed each time. Every rejection
 * reason is logged and saved, so a failure can be traced to the check that caused it.
 *   LIVE_MAX_USD=0.3 npx vitest run --config vitest.live.config.ts tests/reps/delegate-edge.live.test.ts
 */

const CODES = ['29-1141.00', '15-1252.00', '13-2011.00'];
const RUNS = Number(process.env.LIVE_RUNS ?? 5);
const TYPES = (process.env.LIVE_TYPES ?? 'delegate,edge').split(',') as RepType[];

async function inputFor(i: number, type: RepType): Promise<GenerateInput> {
  const code = CODES[i % CODES.length];
  const bundle = (await loadBundle(code))!;
  const shares = typicalWeek(bundle).shares;
  const seed = `live-${type}-${i}-${Date.now() % 100000}`;
  const taskId = chooseTask({ tasks: bundle.tasks, shares, repLog: [], type, day: '2026-11-15', seed })!;
  const task = bundle.tasks.find((t) => t.id === taskId)!;
  return { occupationCode: code, occupation: bundle.title, jobTitle: null, taskId, task: task.text, taskShort: task.short ?? heuristicShort(task.text), locale: 'en', difficulty: 2, seed };
}

describe('Delegate and Edge generation reliability (live)', () => {
  for (const type of TYPES) {
    it(`${type}: ${RUNS} generations`, async () => {
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < RUNS; i++) {
        if (budgetLeft() <= 0) break;
        const input = await inputFor(i, type);
        const t0 = Date.now();
        try {
          const out = type === 'delegate' ? await generateDelegate(input) : await generateEdge(input);
          spend(out.costUsd);
          rows.push({ ok: true, code: input.occupationCode, task: input.taskShort, attempts: out.attempts, cost: +out.costUsd.toFixed(5), ms: Date.now() - t0, rejected: out.rejected, title: out.entry.title });
        } catch (err) {
          rows.push({ ok: false, code: input.occupationCode, task: input.taskShort, error: (err as Error).message, ms: Date.now() - t0 });
        }
        console.info(`[live] ${type} ${i + 1}/${RUNS}`, JSON.stringify(rows[rows.length - 1]).slice(0, 600));
      }
      saveOutput(`${type}-reliability.json`, rows);
      const ok = rows.filter((r) => r.ok).length;
      console.info(`[live] ${type}: ${ok}/${rows.length} ok, attempts ${rows.map((r) => r.attempts ?? 'x').join(',')}, cost $${rows.reduce((n, r) => n + Number(r.cost ?? 0), 0).toFixed(4)}`);
      expect(ok).toBe(rows.length);
    }, 900_000);
  }
});
