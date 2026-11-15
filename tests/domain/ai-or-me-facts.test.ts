import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_OR_ME_FACT_KEYS } from '@/domain/reps';

describe('AI or me facts', () => {
  it('every fact key the domain can give has English copy (no raw keys on screen)', () => {
    const today = JSON.parse(readFileSync(path.join(process.cwd(), 'src/i18n/sections/today.en.json'), 'utf8')) as { aiOrMe: { fact: Record<string, string> } };
    for (const key of AI_OR_ME_FACT_KEYS) {
      expect(typeof today.aiOrMe.fact[key], key).toBe('string');
      expect(today.aiOrMe.fact[key].length, key).toBeGreaterThan(10);
    }
  });
});
