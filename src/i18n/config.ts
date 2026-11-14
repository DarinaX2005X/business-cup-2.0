import type { Locale } from '@/domain/types';

export type { Locale };
/**
 * Locales that have dictionaries in the repo. The interface renders English only (ROUND3, decision 1):
 * RU/KK files stay for the record, nothing offers them and `npm run i18n:check` checks English alone.
 */
export const locales = ['en', 'ru', 'kk'] as const satisfies readonly Locale[];
export const defaultLocale: Locale = 'en';

/** Native names for the language selector. */
export const localeNames: Record<Locale, string> = { en: 'English', ru: 'Русский', kk: 'Қазақша' };

/** BCP 47 tags for Intl (plural rules, numbers, dates). */
export const intlLocale: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' };

/** Former interface-language cookie. Nothing reads or writes it any more; kept so old imports compile. */
export const LOCALE_COOKIE = 'irr_lang';
export const LOCALE_COOKIE_MAX_AGE = 400 * 24 * 3600;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
