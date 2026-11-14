import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSearchIndex, searchOccupations, type LoadedSearchIndex, type SearchIndexFile } from '@/domain/search';
import { ROOT } from './helpers';

// 12 everyday titles from the probe + 10 abbreviations, typos and Cyrillic titles (stage 01.1.1).
// Each must find an expected occupation in the top 2.
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

let idx: LoadedSearchIndex;
beforeAll(() => {
  idx = loadSearchIndex(JSON.parse(readFileSync(join(ROOT, 'data', 'build', 'search-index.json'), 'utf8')) as SearchIndexFile);
}, 60_000);

describe('occupation search over the built index', () => {
  it.each(CASES)('"%s" finds the right occupation in the top 2', (q, expected) => {
    const { results } = searchOccupations(idx, q);
    const top2 = results.slice(0, 2).map((r) => r.code);
    expect(top2.some((c) => expected.includes(c)), `${q} → ${top2.join(', ')}`).toBe(true);
  });

  it('groups by occupation and returns at most 8', () => {
    const { results } = searchOccupations(idx, 'nurse');
    expect(results.length).toBeLessThanOrEqual(8);
    expect(new Set(results.map((r) => r.code)).size).toBe(results.length);
    expect(results[0].code).toBe('29-1141.00');
  });

  it('strips seniority words and works on prefixes while typing', () => {
    expect(searchOccupations(idx, 'senior paralegal II').results[0].code).toBe('23-2011.00');
    expect(searchOccupations(idx, 'dental hyg').results[0].code).toBe('29-1292.00');
  });

  it('every real title in the table is confident', () => {
    for (const [q] of CASES) {
      const r = searchOccupations(idx, q);
      expect(r.confident, q).toBe(true);
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it.each(['xyzzy qwerty', 'asdf', 'asdfgh', 'qwzx', 'lorem ipsum dolor', 'kjhgf'])('nonsense "%s" returns no occupation', (q) => {
    const r = searchOccupations(idx, q);
    expect(r.confident).toBe(false);
    expect(r.results).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it('a real word inside nonsense becomes a suggestion, not a result', () => {
    const r = searchOccupations(idx, 'nurse xyzzy');
    expect(r.results).toEqual([]);
    expect(r.suggestions.map((s) => s.code)).toContain('29-1141.00');
  });

  it('is safe on long and odd input', () => {
    expect(() => searchOccupations(idx, 'registered nurse '.repeat(40))).not.toThrow();
    expect(searchOccupations(idx, 'registered nurse '.repeat(40)).results[0]?.code).toBe('29-1141.00');
    expect(searchOccupations(idx, '').results).toEqual([]);
    expect(searchOccupations(idx, undefined as unknown as string).results).toEqual([]);
  });

  it('curated Russian and Kazakh titles', () => {
    expect(searchOccupations(idx, 'дальнобойщик').results[0].code).toBe('53-3032.00');
    expect(searchOccupations(idx, 'жүк көлігінің жүргізушісі').results[0].code).toBe('53-3032.00');
    expect(searchOccupations(idx, 'менеджер по продукту').results[0].code).toBe('11-2021.00');
    expect(searchOccupations(idx, 'мейірбике').results[0].code).toBe('29-1141.00');
  });
});
