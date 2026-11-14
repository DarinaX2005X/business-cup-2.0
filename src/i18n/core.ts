import { intlLocale, type Locale } from './config';

/**
 * Translator shared by server and client.
 *
 * Dictionaries: `src/i18n/sections/<section>.<locale>.json`, nested objects allowed; the key is
 * `<section>.<path>`, e.g. `common.errors.network`. `_draft` (array of keys awaiting review) is ignored.
 *
 * Plurals: pass `count` and define `key_one`, `key_few`, `key_many`, `key_other` (Intl.PluralRules
 * categories for the locale; `_other` is the fallback). Placeholders:
 *   `{name}`            — strings as is, numbers formatted for the locale
 *   `{n, number}`       — number
 *   `{n, integer}`      — rounded number
 *   `{n, percent}`      — 0..1 → "42%"
 *   `{n, currency}`     — USD, no cents
 *   `{d, date}`         — Date or ISO string → medium date
 * Missing RU/KK keys fall back to English (warning in development); a missing English key returns the key.
 */

export type Messages = Record<string, string>;
export type TParams = Record<string, string | number | Date | null | undefined>;
export type TFunction = (key: string, params?: TParams) => string;

export interface Formatters {
  number(n: number, opts?: Intl.NumberFormatOptions): string;
  integer(n: number): string;
  percent(fraction: number, digits?: number): string;
  currency(usd: number, opts?: { cents?: boolean }): string;
  date(d: Date | string, style?: 'medium' | 'long' | 'short'): string;
  plural(count: number): Intl.LDMLPluralRule;
}

export function flattenMessages(tree: unknown, prefix = '', out: Messages = {}): Messages {
  if (!tree || typeof tree !== 'object') return out;
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    if (k === '_draft') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenMessages(v, key, out);
  }
  return out;
}

/** `{ common: {...}, today: {...} }` (one locale's catalog) → flat messages. */
export function catalogToMessages(catalog: Record<string, unknown>): Messages {
  return flattenMessages(catalog);
}

export function createFormatters(locale: Locale): Formatters {
  const tag = intlLocale[locale];
  const plural = new Intl.PluralRules(tag);
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (opts: Intl.NumberFormatOptions) => {
    const k = JSON.stringify(opts);
    let f = cache.get(k);
    if (!f) cache.set(k, (f = new Intl.NumberFormat(tag, opts)));
    return f;
  };
  return {
    number: (n, opts = {}) => nf(opts).format(n),
    integer: (n) => nf({ maximumFractionDigits: 0 }).format(Math.round(n)),
    percent: (fraction, digits = 0) => nf({ style: 'percent', maximumFractionDigits: digits }).format(fraction),
    currency: (usd, opts = {}) =>
      nf({ style: 'currency', currency: 'USD', maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0 }).format(usd),
    date: (d, style = 'medium') => new Intl.DateTimeFormat(tag, { dateStyle: style, timeZone: 'UTC' }).format(typeof d === 'string' ? new Date(d) : d),
    plural: (count) => plural.select(count),
  };
}

const warned = new Set<string>();
function warnOnce(msg: string) {
  if (process.env.NODE_ENV === 'production' || warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[i18n] ${msg}`);
}

function formatValue(value: TParams[string], style: string | undefined, f: Formatters): string {
  if (value === null || value === undefined) return '';
  switch (style) {
    case 'number':
      return f.number(Number(value));
    case 'integer':
      return f.integer(Number(value));
    case 'percent':
      return f.percent(Number(value));
    case 'currency':
      return f.currency(Number(value));
    case 'date':
      return f.date(value instanceof Date ? value : String(value));
    default:
      if (typeof value === 'number') return f.number(value);
      if (value instanceof Date) return f.date(value);
      return String(value);
  }
}

export function interpolate(template: string, params: TParams | undefined, f: Formatters): string {
  if (!params) return template;
  return template.replace(/\{\s*(\w+)\s*(?:,\s*(\w+)\s*)?\}/g, (whole, name: string, style?: string) =>
    name in params ? formatValue(params[name], style, f) : whole,
  );
}

export function createTranslator(locale: Locale, messages: Messages, fallback: Messages | null): TFunction {
  const f = createFormatters(locale);
  const enF = fallback ? createFormatters('en') : f;

  const lookup = (dict: Messages, key: string, count: number | undefined, fmt: Formatters): string | undefined => {
    if (count !== undefined) {
      const form = dict[`${key}_${fmt.plural(count)}`] ?? dict[`${key}_other`];
      if (form !== undefined) return form;
    }
    return dict[key];
  };

  return (key, params) => {
    const count = typeof params?.count === 'number' ? params.count : undefined;
    const own = lookup(messages, key, count, f);
    if (own !== undefined) return interpolate(own, params, f);
    if (fallback) {
      const en = lookup(fallback, key, count, enF);
      if (en !== undefined) {
        warnOnce(`missing ${locale} key "${key}", showing English`);
        return interpolate(en, params, f);
      }
    }
    warnOnce(`missing key "${key}"`);
    return key;
  };
}
