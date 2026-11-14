import { catalogToMessages, createFormatters, createTranslator, type Formatters, type Messages, type TFunction } from './core';
import { isLocale, type Locale } from './config';
import en from './catalog/en';
import ru from './catalog/ru';
import kk from './catalog/kk';

/**
 * Server-side dictionaries (all locales bundled; the client loads them per locale, see client.tsx).
 * Safe to import from route handlers, server components and scripts.
 */
const catalogs: Record<Locale, Record<string, unknown>> = { en, ru, kk };
const flatCache = new Map<Locale, Messages>();

export function getMessages(locale: Locale): Messages {
  let m = flatCache.get(locale);
  if (!m) flatCache.set(locale, (m = catalogToMessages(catalogs[locale])));
  return m;
}

export function getT(locale: Locale | string | null | undefined): TFunction & { locale: Locale; f: Formatters } {
  const loc: Locale = isLocale(locale) ? locale : 'en';
  const t = createTranslator(loc, getMessages(loc), loc === 'en' ? null : getMessages('en'));
  return Object.assign(t, { locale: loc, f: createFormatters(loc) });
}
