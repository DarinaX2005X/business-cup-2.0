import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiError, callModel, StrictSchemaError, strictSchema } from '@/server/ai/client';
import { getBudgetStatus, RATE_LIMITS } from '@/server/ai/budget';
import { pingSchema } from '@/server/ai/prompts/ping';
import { useTempStore } from './helpers';

const schema = z.object({ word: z.string(), n: z.number().int().nullable() });

function okResponse(content: unknown, cost = 0.0001, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: 'gen-test',
      choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 50, completion_tokens: 10, cost, completion_tokens_details: { reasoning_tokens: 0 } },
      ...extra,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const base = { op: 'test.op', schema, system: 'sys', user: 'hello', locale: 'en' as const, maxTokens: 200, temperature: 0 };

let cleanup: () => void;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  ({ cleanup } = useTempStore());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('AI_BUDGET_USD', '1');
  vi.stubEnv('AI_DAILY_CAP_USD', '1');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('strictSchema', () => {
  it('turns nullable into a type pair and closes every object', () => {
    const js = strictSchema(z.object({ a: z.string(), b: z.number().int().nullable(), c: z.array(z.object({ k: z.enum(['x', 'y']).nullable() })) }));
    expect(js).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: ['integer', 'null'] },
        c: {
          type: 'array',
          items: { type: 'object', properties: { k: { type: ['string', 'null'], enum: ['x', 'y', null] } }, required: ['k'], additionalProperties: false },
        },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    });
    expect(() => strictSchema(pingSchema)).not.toThrow();
  });

  it.each([
    ['optional field', z.object({ a: z.string().optional() }), /optional fields/],
    ['union', z.object({ a: z.union([z.string(), z.number()]) }), /unions/],
    ['record', z.object({ a: z.record(z.string(), z.string()) }), /fixed properties/],
    ['any', z.object({ a: z.any() }), /concrete "type"/],
    ['loose object', z.object({ a: z.looseObject({ b: z.string() }) }), /additionalProperties/],
    ['non-object root', z.array(z.string()), /root/],
  ])('rejects %s', (_name, s, msg) => {
    expect(() => strictSchema(s as z.ZodType)).toThrow(StrictSchemaError);
    expect(() => strictSchema(s as z.ZodType)).toThrow(msg);
  });
});

describe('callModel', () => {
  it('sends a strict json_schema request and returns validated data with usage', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ word: 'работа', n: 6 }, 0.0002));
    const res = await callModel(base);
    expect(res).toEqual({ data: { word: 'работа', n: 6 }, usage: { promptTokens: 50, completionTokens: 10, reasoningTokens: 0, costUsd: 0.0002 }, cached: false });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'test_op', strict: true } });
    expect(body.reasoning).toEqual({ effort: 'minimal', exclude: true });
    expect(body.max_tokens).toBe(200);
    const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['X-Title']).toBe('Irreplaceable');
    const status = await getBudgetStatus();
    expect(status.totalUsd).toBeCloseTo(0.0002, 8); // reservation settled to the real cost
    expect(status.dayUsd).toBeCloseTo(0.0002, 8);
  });

  it('serves a repeated deterministic call from the cache without spending', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ word: 'a', n: null }, 0.0003));
    const first = await callModel({ ...base, cacheKey: 'same-input' });
    const second = await callModel({ ...base, cacheKey: 'same-input' });
    expect(first.cached).toBe(false);
    expect(second).toEqual({ data: { word: 'a', n: null }, usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 }, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getBudgetStatus()).totalUsd).toBeCloseTo(0.0003, 8);
  });

  it('retries once with the validation error, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ word: 5 })).mockResolvedValueOnce(okResponse({ word: 'ok', n: 1 }));
    const res = await callModel(base);
    expect(res.data).toEqual({ word: 'ok', n: 1 });
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));
    expect(retryBody.messages.at(-1).content).toMatch(/does not match the schema: word/);
    expect(res.usage.costUsd).toBeCloseTo(0.0002, 8); // both attempts are counted
  });

  it('gives invalid_output after a second bad answer', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('not json')).mockResolvedValueOnce(okResponse('{"word":'));
    await expect(callModel(base)).rejects.toMatchObject({ code: 'invalid_output' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps provider statuses to clear error codes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 429, message: 'slow down' } }), { status: 429 }));
    await expect(callModel(base)).rejects.toMatchObject({ code: 'rate_limited' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 402, message: 'no credits' } }), { status: 402 }));
    await expect(callModel(base)).rejects.toMatchObject({ code: 'budget_exceeded' });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(callModel(base)).rejects.toMatchObject({ code: 'timeout' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, message: 'bad schema' } }), { status: 400 }));
    await expect(callModel(base)).rejects.toMatchObject({ code: 'provider_error' });
    // failed requests before generation are released from the budget; the timeout keeps its reservation
    const s = await getBudgetStatus();
    expect(s.totalUsd).toBeGreaterThan(0);
    expect(s.totalUsd).toBeLessThan(0.002);
  });

  it('retries once on a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(okResponse({ word: 'x', n: 0 }));
    expect((await callModel(base)).data.word).toBe('x');
  });

  it('refuses before calling when the budget would be exceeded', async () => {
    vi.stubEnv('AI_BUDGET_USD', '0.0001');
    const err = await callModel(base).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: 'budget_exceeded', status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getBudgetStatus()).totalUsd).toBe(0); // the refused reservation was rolled back
  });

  it('never lets parallel calls jointly overspend the daily cap', async () => {
    // worst case per call ≈ 200 output tokens × $4.125/M + prompt ≈ $0.00087; cap fits 3 reservations
    vi.stubEnv('AI_DAILY_CAP_USD', '0.0027');
    fetchMock.mockImplementation(async () => okResponse({ word: 'x', n: 1 }, 0.0008));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => callModel(base)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThanOrEqual(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'budget_exceeded')).toBe(true);
    expect((await getBudgetStatus()).dayUsd).toBeLessThanOrEqual(0.0027);
  });

  it('limits a profile to 25 model calls a day and an IP to 60', async () => {
    fetchMock.mockImplementation(async () => okResponse({ word: 'x', n: 1 }, 0.00001));
    for (let i = 0; i < RATE_LIMITS.profilePerDay; i++) await callModel({ ...base, actor: { profileId: 'p1', ip: '1.2.3.4' } });
    await expect(callModel({ ...base, actor: { profileId: 'p1', ip: '1.2.3.4' } })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    // a cached answer is still served to a limited profile
    fetchMock.mockClear();
    await callModel({ ...base, cacheKey: 'c', actor: { profileId: 'p2' } });
    for (let i = 0; i < 26; i++) await callModel({ ...base, cacheKey: 'c', actor: { profileId: 'p1' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // IP limit across profiles: 25 used above by p1 on this IP, 35 more fit
    for (let i = 0; i < RATE_LIMITS.ipPerDay - RATE_LIMITS.profilePerDay; i++) {
      await callModel({ ...base, actor: { profileId: `q${i}`, ip: '1.2.3.4' } });
    }
    await expect(callModel({ ...base, actor: { profileId: 'fresh', ip: '1.2.3.4' } })).rejects.toMatchObject({ code: 'rate_limited' });
  }, 30_000);

  it('fails clearly without a key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(callModel(base)).rejects.toMatchObject({ code: 'provider_error', message: 'OPENROUTER_API_KEY is not set' });
  });
});
