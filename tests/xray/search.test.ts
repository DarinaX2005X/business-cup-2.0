import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasCyrillic } from '@/domain/text';
import { searchTitles } from '@/server/xray/search';
import { getSearchIndex } from '@/server/xray/data';
import { useTempStore } from '../platform/helpers';

// The 22 queries of 01.1.1 through the route's service: expected occupation in the top 2.
const CASES: [string, string[]][] = [
  ['registered nurse', ['29-1141.00']],
  ['accounts payable specialist', ['43-3031.00']],
  ['truck dispatcher', ['43-5032.00']],
  ['middle school math teacher', ['25-2022.00']],
  ['paralegal', ['23-2011.00']],
  ['HR generalist', ['13-1071.00']],
  ['marketing manager', ['11-2021.00']],
  ['electrician', ['47-2111.00']],
  ['dental hygienist', ['29-1292.00']],
  ['insurance claims adjuster', ['13-1031.00']],
  ['customer service representative', ['43-4051.00']],
  ['software engineer', ['15-1252.00']],
  ['SWE', ['15-1252.00']],
  ['sofware enginer', ['15-1252.00']],
  ['AP clerk', ['43-3031.00']],
  ['RN', ['29-1141.00']],
  ['uber driver', ['53-3054.00']],
  ['медсестра', ['29-1141.00']],
  ['бухгалтер', ['13-2011.00', '43-3031.00']],
  ['электрик', ['47-2111.00']],
  ['мұғалім', ['25-2021.00', '25-2022.00', '25-2031.00']],
  ['product manager', ['11-2021.00']],
];

let cleanup: () => void;
const fetchMock = vi.fn<typeof fetch>();

function modelAnswer(content: unknown) {
  return new Response(
    JSON.stringify({ id: 'gen', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 40, completion_tokens: 8, cost: 0.00001 } }),
    { status: 200 },
  );
}

beforeAll(async () => {
  await getSearchIndex();
}, 60_000);

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

describe('GET /api/occupations/search service', () => {
  it.each(CASES)('"%s" → expected occupation in the top 2, no model call', async (q, expected) => {
    const res = await searchTitles(q, 'en');
    const top2 = res.results.slice(0, 2).map((r) => r.code);
    expect(top2.some((c) => expected.includes(c)), `${q} → ${top2.join(', ')}`).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows why it matched: alias text and the occupation title', async () => {
    const { results } = await searchTitles('RN', 'en');
    expect(results[0]).toMatchObject({ code: '29-1141.00', title: 'Registered Nurses', kind: 'alias' });
    expect(results[0].matched).toMatch(/RN/);
  });

  it('gives the Russian occupation title for locale ru', async () => {
    const { results } = await searchTitles('медсестра', 'ru');
    expect(results[0].code).toBe('29-1141.00');
    expect(results[0].localTitle).toBeTruthy();
  });

  it('nonsense: no results, at most 3 word suggestions, no model call for Latin text', async () => {
    const a = await searchTitles('qwzx', 'en');
    expect(a.results).toEqual([]);
    const b = await searchTitles('zzqx plumberr welderr nursse', 'en');
    expect(b.suggestions.length).toBeLessThanOrEqual(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Cyrillic title missing from the index → title.translate → English search', async () => {
    fetchMock.mockResolvedValueOnce(modelAnswer({ isJobTitle: true, english: 'Crane Operator' }));
    const res = await searchTitles('машинист башенного крана', 'ru');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.translated).toBe('Crane Operator');
    expect(res.results[0].code).toBe('53-7021.00');
    // second time from the cache
    const again = await searchTitles('машинист башенного крана', 'ru');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.results[0].code).toBe('53-7021.00');
  });

  it('Cyrillic nonsense: the model says it is not a job → empty, no hint', async () => {
    fetchMock.mockResolvedValueOnce(modelAnswer({ isJobTitle: false, english: null }));
    const res = await searchTitles('ывапролджэ', 'ru');
    expect(res.results).toEqual([]);
    expect(res.hint).toBeNull();
  });

  it('budget exhausted during translation → empty result with the try_english hint', async () => {
    vi.stubEnv('AI_BUDGET_USD', '0');
    const res = await searchTitles('машинист башенного крана', 'ru');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ results: [], hint: 'try_english' });
  });

  it('answers in under 50 ms on a warm index', async () => {
    for (const q of ['nurse', 'accountant', 'electrician']) await searchTitles(q, 'en');
    const times: number[] = [];
    for (const [q] of CASES.filter(([q]) => !hasCyrillic(q))) {
      const t = performance.now();
      await searchTitles(q, 'en');
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.9)]).toBeLessThan(50);
  });
});
