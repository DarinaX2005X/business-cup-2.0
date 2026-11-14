import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseTask } from '@/domain/reps';
import type { RepType } from '@/domain/types';
import { repDelegatePrompt } from '@/server/ai/prompts/rep-delegate';
import { repEdgePrompt } from '@/server/ai/prompts/rep-edge';
import { repGradeDelegatePrompt, repGradeEdgePrompt } from '@/server/ai/prompts/rep-grade';
import { repSlipPrompt } from '@/server/ai/prompts/rep-slip';
import { repVerifyDelegatePrompt, repVerifySlipPrompt } from '@/server/ai/prompts/rep-verify';
import { createProfile, getProfile } from '@/server/profile';
import { createRep, startTrial } from '@/server/reps';
import type { GenerateInput } from '@/server/reps/generate';
import { plannedTypes } from '@/server/reps/error-types';
import { loadBundle, typicalWeek } from '@/server/xray';
import { createXray } from '@/server/xray/records';
import { useTempStore } from '../platform/helpers';

/**
 * The nurse-for-engineer class of bug: a Software Developers profile must get reps built only from
 * Software Developers tasks, and the prompts the writers receive must carry only that occupation, its
 * task and the person's job title — no examples or text from other jobs.
 */

const captured = vi.hoisted(() => ({ inputs: [] as { type: string; input: unknown }[] }));

vi.mock('@/server/reps/generate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/reps/generate')>();
  const { AiError } = await import('@/server/ai/client');
  const stub = (type: string) =>
    vi.fn(async (input: unknown) => {
      captured.inputs.push({ type, input });
      throw new AiError('provider_error', 'captured only', { op: `rep.${type}` });
    });
  return { ...real, generateSlip: stub('slip'), generateDelegate: stub('delegate'), generateEdge: stub('edge') };
});

const DEV = '15-1252.00';
const OTHER_JOBS = /\b(nurs\w*|patient|discharge|clinic\w*|medication|dose|allerg\w*|accountant|ledger|electrician|breaker|ambulance|dispatch\w*|PCP|MAR)\b/i;
const env = { ...process.env };
let cleanup: () => void;

beforeAll(() => Object.assign(process.env, { DEV_FORCE_PRO: '1', OPENROUTER_API_KEY: 'test-key' }));
afterAll(() => {
  process.env = env;
});
beforeEach(() => {
  ({ cleanup } = useTempStore());
  captured.inputs = [];
});
afterEach(() => cleanup());

describe('Software Developers get only Software Developers reps', () => {
  it('edge, slip and delegate pick tasks of the person\'s own week; edge prefers the human part of it', async () => {
    const dev = (await loadBundle(DEV))!;
    const shares = typicalWeek(dev).shares;
    const inWeek = new Set(shares.map((s) => s.taskId));
    const byId = new Map(dev.tasks.map((t) => [t.id, t]));
    const humanInWeek = shares.some((s) => byId.get(s.taskId)!.evidence.category === 'human_edge');
    for (const type of ['slip', 'delegate', 'edge'] as RepType[]) {
      for (let i = 0; i < 25; i++) {
        const id = chooseTask({ tasks: dev.tasks, shares, repLog: [], type, day: '2026-11-15', seed: `s${i}` })!;
        expect(inWeek.has(id)).toBe(true);
        if (type === 'edge' && humanInWeek) expect(byId.get(id)!.evidence.category).toBe('human_edge');
      }
    }
    // a week with no human-edge task: edge takes the week's most human task (people work, least automated)
    const noHuman = shares.filter((s) => byId.get(s.taskId)!.evidence.category !== 'human_edge');
    const edgeId = chooseTask({ tasks: dev.tasks, shares: noHuman, repLog: [], type: 'edge', day: '2026-11-15', seed: 'x' })!;
    expect(noHuman.some((s) => s.taskId === edgeId)).toBe(true);
  });

  it('every writer gets the developer\'s occupation, job title and own task, and its prompt has no other job in it', async () => {
    const { profile } = await createProfile({ locale: 'en', tz: 'America/Chicago' });
    const dev = (await loadBundle(DEV))!;
    await createXray({ profile, occupationCode: DEV, shares: typicalWeek(dev).shares, jobTitle: 'Senior Software Engineer', inputSource: 'resume' });
    const ctx = async () => ({ profile: (await getProfile(profile.id))!, headerTz: 'America/Chicago', now: new Date('2026-11-15T15:00:00Z') });
    for (const type of ['slip', 'delegate', 'edge'] as RepType[]) await createRep(await ctx(), { type, kind: 'extra' }).catch(() => undefined);
    await startTrial(await ctx()).catch(() => undefined);
    expect(captured.inputs.map((c) => c.type).sort()).toEqual(['delegate', 'edge', 'slip', 'slip']);

    const devTasks = new Map(dev.tasks.map((t) => [t.id, t.text]));
    for (const { type, input } of captured.inputs) {
      const i = input as GenerateInput;
      expect(i.occupationCode).toBe(DEV);
      expect(i.occupation).toBe(dev.title);
      expect(i.jobTitle).toBe('Senior Software Engineer');
      expect(devTasks.get(i.taskId)).toBe(i.task);
      const prompts =
        type === 'slip'
          ? [repSlipPrompt.system(i.locale), repSlipPrompt.user({ ...i, types: plannedTypes(i.occupationCode, 3, 0) })]
          : type === 'delegate'
            ? [repDelegatePrompt.system(i.locale), repDelegatePrompt.user(i)]
            : [repEdgePrompt.system(i.locale), repEdgePrompt.user(i)];
      const text = prompts.join('\n');
      expect(text).toContain(dev.title);
      expect(text).toContain('Senior Software Engineer');
      expect(text).toContain(i.task);
      expect(text).not.toMatch(OTHER_JOBS);
    }
  });

  it('grading and verification prompts carry no other job either', () => {
    const texts = [
      repGradeDelegatePrompt.system('en'),
      repGradeEdgePrompt.system('en'),
      repVerifySlipPrompt.system(),
      repVerifyDelegatePrompt.system(),
    ].join('\n');
    expect(texts).not.toMatch(OTHER_JOBS);
  });
});

