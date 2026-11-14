import { describe, expect, it } from 'vitest';
import { categoriesFor } from '@/domain/reps';
import { generateSlip, SLIP_RETRIES } from '@/server/reps';
import { heuristicShort, loadBundle, typicalWeek } from '@/server/xray';
import { budgetLeft, loadLiveEnv, saveOutput, spend } from './live-helpers';

loadLiveEnv();

const CODES = (process.env.LIVE_CODES ?? '29-1141.00,13-2011.00,47-2111.00').split(',');
const DIFFICULTY = Number(process.env.LIVE_DIFFICULTY ?? 2) as 1 | 2 | 3;
const LOCALE = (process.env.LIVE_LOCALE ?? 'en') as 'en' | 'ru' | 'kk';

describe('rep.slip live', () => {
  for (const code of CODES) {
    it(`generates a validated slip for ${code} within the retry limit`, async () => {
      if (budgetLeft() <= 0) return void console.warn('live budget used up; skipped');
      const bundle = (await loadBundle(code))!;
      const week = typicalWeek(bundle).shares;
      const ai = week.filter((s) => categoriesFor('slip').includes(bundle.tasks.find((t) => t.id === s.taskId)!.evidence.category));
      const pick = (ai[0] ?? week[0]).taskId;
      const task = bundle.tasks.find((t) => t.id === pick)!;
      const out = await generateSlip({
        occupationCode: code,
        occupation: bundle.title,
        taskId: task.id,
        task: task.text,
        taskShort: heuristicShort(task.text),
        locale: LOCALE,
        difficulty: DIFFICULTY,
        seed: `live-${code}-${Date.now() % 1000}`,
      });
      const total = spend(out.costUsd);
      const file = saveOutput(`slip-${code}-${LOCALE}.json`, { ...out });
      const s = out.entry.slip;
      console.info(`${code} ${bundle.title}: attempts=${out.attempts} cost=$${out.costUsd.toFixed(4)} total=$${total.toFixed(4)} words=${s.document.split(/\s+/).length} → ${file}`);
      for (const e of s.errors) expect(s.document.slice(e.start, e.end)).toBe(e.quote);
      expect(out.attempts).toBeLessThanOrEqual(1 + SLIP_RETRIES); // the verifier may reject; bank fallback after that
    });
  }
});
