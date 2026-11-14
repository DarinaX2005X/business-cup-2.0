import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Live model checks (tests/reps/*.live.test.ts, run with `npm run test:live -- tests/reps`): they read
 * .env.local, spend real money and stop once LIVE_MAX_USD (default 0.3) is used up in this process.
 * Outputs go to LIVE_OUT_DIR (default .data/live-reps, outside git) for reading by eye.
 */

export function loadLiveEnv(): void {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const g = globalThis as unknown as { __liveSpend?: number };

export function spend(usd: number): number {
  g.__liveSpend = (g.__liveSpend ?? 0) + usd;
  return g.__liveSpend;
}

export function budgetLeft(): number {
  const max = Number(process.env.LIVE_MAX_USD ?? 0.3);
  return max - (g.__liveSpend ?? 0);
}

export function saveOutput(name: string, value: unknown): string {
  const dir = process.env.LIVE_OUT_DIR || path.join(process.cwd(), '.data', 'live-reps');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}
