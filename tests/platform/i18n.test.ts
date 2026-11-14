import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFormatters, createTranslator } from '@/i18n/core';
import { getT } from '@/i18n/messages';
import { checkDictionaries } from '../../scripts/i18n/check';
import { paths } from '../../scripts/i18n/lib';

afterEach(() => vi.restoreAllMocks());

describe('t()', () => {
  const en = { 'x.items_one': '{count} item', 'x.items_other': '{count} items', 'x.hello': 'Hi, {name}', 'x.only_en': 'English only' };
  const ru = { 'x.items_one': '{count} задача', 'x.items_few': '{count} задачи', 'x.items_many': '{count} задач', 'x.items_other': '{count} задачи', 'x.hello': 'Привет, {name}' };

  it('picks Russian plural forms by Intl.PluralRules', () => {
    const t = createTranslator('ru', ru, en);
    expect([1, 2, 5, 11, 21, 22, 1.5].map((count) => t('x.items', { count }))).toEqual([
      '1 задача',
      '2 задачи',
      '5 задач',
      '11 задач',
      '21 задача',
      '22 задачи',
      '1,5 задачи',
    ]);
  });

  it('falls back to English for a missing key and warns in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = createTranslator('kk', {}, en);
    expect(t('x.only_en')).toBe('English only');
    expect(t('x.items', { count: 3 })).toBe('3 items');
    expect(t('x.nowhere')).toBe('x.nowhere');
    expect(warn).toHaveBeenCalled();
  });

  it('formats numbers, money, percents and dates for each locale', () => {
    const t = createTranslator('ru', { 'm.v': '{n} · {usd, currency} · {p, percent} · {d, date}' }, null);
    const out = t('m.v', { n: 12345.6, usd: 72000, p: 0.42, d: '2026-11-14' });
    expect(out.replace(/\s/g, ' ')).toBe('12 345,6 · 72 000 $ · 42 % · 14 нояб. 2026 г.');
    const en = createFormatters('en');
    expect(en.currency(72000)).toBe('$72,000');
    expect(en.date('2026-11-14')).toBe('Nov 14, 2026');
    const kk = createFormatters('kk');
    expect(kk.number(12345.6).replace(/\s/g, ' ')).toBe('12 345,6');
    expect(kk.plural(1)).toBe('one');
    expect(kk.plural(5)).toBe('other');
  });

  it('serves the real dictionaries in all three languages', () => {
    expect(getT('en')('common.errors.network')).toMatch(/connection/);
    expect(getT('ru')('common.points.earned', { count: 3 })).toBe('+3 поинта');
    expect(getT('kk')('common.actions.retry')).not.toBe('common.actions.retry');
    expect(getT('xx').locale).toBe('en');
  });
});

describe('i18n:check', () => {
  it('passes on the repository dictionaries', () => {
    expect(checkDictionaries().problems).toEqual([]);
  });

  it('catches a missing key, an extra key and a broken placeholder', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'irr-i18n-'));
    const original = paths.sections;
    try {
      cpSync(original, dir, { recursive: true });
      paths.sections = dir;
      const file = path.join(dir, 'common.kk.json');
      const kk = JSON.parse(readFileSync(file, 'utf8'));
      delete kk.actions.retry;
      kk.actions.extra = 'Артық';
      kk.points.earned_one = '+ ұпай';
      writeFileSync(file, JSON.stringify(kk));
      const { problems } = checkDictionaries();
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining('missing "common.actions.retry"'),
          expect.stringContaining('extra key "common.actions.extra"'),
          expect.stringContaining('"common.points.earned_one" placeholders'),
        ]),
      );
    } finally {
      paths.sections = original;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
