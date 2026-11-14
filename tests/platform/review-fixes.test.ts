import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callModel, reasoningParam } from '@/server/ai/client';
import { budgetKeys, getBudgetStatus } from '@/server/ai/budget';
import { createFsStore } from '@/server/store/fs';
import { setStoreForTests, type Store } from '@/server/store';
import { POST } from '@/app/api/profile/route';
import { clientIp } from '@/server/profile/http';

// ---------------------------------------------------------------------------------------------
// Budget counters are global; rate limits stay per environment

describe('global budget, per-environment rate limits', () => {
  let envStore: Store;
  let globalStore: Store;
  const dirs: string[] = [];
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    for (let i = 0; i < 2; i++) dirs.push(mkdtempSync(path.join(tmpdir(), 'irr-g-')));
    envStore = createFsStore(dirs[0]);
    globalStore = createFsStore(dirs[1]);
    setStoreForTests(envStore, globalStore);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENROUTER_API_KEY', 'k');
    vi.stubEnv('AI_BUDGET_USD', '1');
    vi.stubEnv('AI_DAILY_CAP_USD', '1');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"a":"x"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0004 } })),
    );
  });
  afterEach(() => {
    setStoreForTests(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('writes spend to the global store and rate-limit counters to the environment store', async () => {
    await callModel({ op: 't', schema: z.object({ a: z.string() }), system: 's', user: 'u', locale: 'en', maxTokens: 50, temperature: 0, actor: { profileId: 'P', ip: '1.1.1.1' } });
    expect(await globalStore.getNumber(budgetKeys.total)).toBeCloseTo(0.0004, 8);
    expect(await envStore.getNumber(budgetKeys.total)).toBe(0);
    expect((await getBudgetStatus()).totalUsd).toBeCloseTo(0.0004, 8);
    expect((await envStore.list('rl:profile:P:')).length).toBe(1);
    expect(await globalStore.list('rl:')).toEqual([]);
  });

  it('a spend recorded by another environment counts against this one', async () => {
    await globalStore.incrFloat(budgetKeys.total, 0.99995); // e.g. production already spent this
    await expect(
      callModel({ op: 't', schema: z.object({ a: z.string() }), system: 's', user: 'u', locale: 'en', maxTokens: 50, temperature: 0 }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------

describe('reasoning parameter', () => {
  it("never sends 'enabled: false' to models that require reasoning", () => {
    expect(reasoningParam('off', 'google/gemini-3.8-flash')).toEqual({ effort: 'minimal', exclude: true });
    expect(reasoningParam('off', 'some/other-model')).toEqual({ enabled: false, exclude: true });
    expect(reasoningParam('low', 'google/gemini-3.8-flash')).toEqual({ effort: 'low', exclude: true });
  });
});

// ---------------------------------------------------------------------------------------------

describe('rate limits without an IP header', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'irr-ip-'));
    setStoreForTests(createFsStore(dir));
  });
  afterEach(() => {
    setStoreForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts requests without an IP into one shared "unknown" bucket instead of skipping the limit', async () => {
    vi.stubEnv('PROFILE_CREATE_PER_DAY', '30');
    expect(clientIp(new Request('http://x/'))).toBe('unknown');
    expect(clientIp(new Request('http://x/', { headers: { 'x-forwarded-for': '5.5.5.5, 10.0.0.1' } }))).toBe('5.5.5.5');
    const post = () => POST(new Request('http://x/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"locale":"en"}' }));
    for (let i = 0; i < 30; i++) expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  }, 20_000);
});

// ---------------------------------------------------------------------------------------------
// Browser credential slots (with a minimal fake window/document)

function installFakeBrowser() {
  const storage = new Map<string, string>();
  let cookieJar: Record<string, string> = {};
  const fakeWindow = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    location: { protocol: 'https:', origin: 'https://irreplaceable.example' },
  };
  const fakeDocument = {
    get cookie() {
      return Object.entries(cookieJar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split('; ');
      const [k, v] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (attrs.some((a) => a === 'Max-Age=0')) {
        const { [k]: _gone, ...rest } = cookieJar;
        void _gone;
        cookieJar = rest;
      } else cookieJar = { ...cookieJar, [k]: v };
    },
  };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  return { storage, cookies: () => cookieJar };
}

describe('credential slots', () => {
  afterEach(() => vi.unstubAllGlobals());
  const A = { id: 'A'.repeat(22), secret: 'a'.repeat(43) };
  const B = { id: 'B'.repeat(22), secret: 'b'.repeat(43) };

  it('keeps the replaced profile as "previous" and an unrecognised one as "orphan", never just deleting it', async () => {
    const browser = installFakeBrowser();
    const c = await import('@/lib/client/credentials');
    c.saveCredentials(A);
    expect(browser.cookies().irr_p).toBe(`${A.id}.${A.secret}`);
    c.saveCredentials(B);
    expect(c.loadCredentials()).toEqual(B);
    expect(c.loadPreviousCredentials()).toEqual(A);

    c.orphanCredentials(B);
    expect(c.loadCredentials()).toBeNull();
    expect(browser.cookies().irr_p).toBeUndefined();
    expect(c.loadOrphanCredentials()).toEqual(B);
    c.clearOrphanCredentials();
    expect(c.loadOrphanCredentials()).toBeNull();
  });

  it('builds restore links with the secret in the fragment', async () => {
    installFakeBrowser();
    const { restoreLinkFor, hasProgress } = await import('@/lib/client/profile');
    expect(restoreLinkFor(A, 'https://irreplaceable.example')).toBe(`https://irreplaceable.example/#restore=${A.id}.${A.secret}`);
    const empty = {
      xrays: [],
      reps: [],
      repLog: [],
      points: { balance: 0, events: [] },
      proof: [],
      redemptions: [],
      plan: { status: 'free' },
    } as unknown as Parameters<typeof hasProgress>[0];
    expect(hasProgress(empty)).toBe(false);
    expect(hasProgress({ ...empty, xrays: ['x'] })).toBe(true);
    expect(hasProgress({ ...empty, points: { balance: 5, events: [] } })).toBe(true);
  });
});
